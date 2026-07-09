import { applyFilterToTile } from "./kernels.js";
import { getPixelFilterOverlap, getPixelFilterProfile } from "./filters.js";
import { TileBufferPool } from "./tile-buffer-pool.js";
import { planTiles, rectByteLength } from "./tiling.js";
import { getRegisteredProcessor } from "./wasm-registry.js";
import {
  PhantomError,
  RGBA_CHANNELS,
  type ProcessPipelineStep,
  type ProcessOptions,
  type ProcessStats,
  type RawRgbaProcessResult,
  type RawRgbaImage,
  type Rect,
  type TileDescriptor,
  type TileProcessor,
  type TileResult,
  type TileSink,
  type TileSource,
  assertRgbaLength,
} from "./types.js";

const DEFAULT_TILE_SIZE = 512;
const DEFAULT_OVERLAP = 1;

/**
 * Module-level buffer pool shared across all synchronous pipeline invocations.
 * Eliminates per-tile allocation for the source read buffer when processing
 * multiple images in sequence (common in batch/pipeline scenarios).
 */
const sharedBufferPool = new TileBufferPool(4);

/** Default deterministic TypeScript tile processor used by the core pipeline. */
export const cpuTileProcessor: TileProcessor = {
  id: "cpu",
  processTile: applyFilterToTile,
};

/**
 * Processes a raw RGBA image by reading overlap-expanded tiles and writing
 * only each tile's core rectangle into a new output image.
 */
export async function processRawImage(
  input: RawRgbaImage,
  options: ProcessOptions = {},
): Promise<RawRgbaImage> {
  const result = await processRawImageWithStats(input, options);
  return result.image;
}

/**
 * Processes a raw RGBA image and returns operational stats for progress UI,
 * logs, and runtime health checks.
 */
export async function processRawImageWithStats(
  input: RawRgbaImage,
  options: ProcessOptions = {},
): Promise<RawRgbaProcessResult> {
  assertRgbaLength(input);

  const { tileSize, overlap, filter } = resolveProcessOptions(options);
  // Precedence: explicit option → registered global processor → CPU baseline
  const tileProcessor =
    options.tileProcessor ?? getRegisteredProcessor() ?? cpuTileProcessor;

  const output: RawRgbaImage = {
    width: input.width,
    height: input.height,
    data: new Uint8Array(input.data.length),
  };

  // Fast-path: synchronous CPU processing avoids all async/Promise overhead
  const isSyncProcessor =
    tileProcessor === cpuTileProcessor || tileProcessor.id === "cpu";

  if (isSyncProcessor && !options.signal) {
    const stats = processRawImageSync(
      input,
      output,
      tileSize,
      overlap,
      filter,
      options,
    );
    return { image: output, stats };
  }

  // Async path for custom tile processors (WASM, GPU, workers)
  const stats = await processTileSourceWithStats(
    { width: input.width, height: input.height },
    createRawTileSource(input),
    createRawTileSink(output),
    options,
  );

  return { image: output, stats };
}

/**
 * Synchronous fast-path for CPU tile processing.
 * Eliminates: Promise overhead, source/sink abstraction overhead,
 * per-tile Uint8Array allocation for source reads (uses subarray views).
 */
function processRawImageSync(
  input: RawRgbaImage,
  output: RawRgbaImage,
  tileSize: number,
  overlap: number,
  filter: import("./types.js").PixelFilter,
  options: ProcessOptions,
): ProcessStats {
  const tiles = planTiles({
    width: input.width,
    height: input.height,
    tileSize,
    overlap,
  });

  const startedAtMs = nowMs();
  let processedTiles = 0;
  let outputBytes = 0;

  // Acquire pooled buffers sized for the largest tile input/output rects.
  // Avoids per-tile allocation and GC pressure on large images.
  let maxInputBytes = 0;
  let maxOutputBytes = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const tile = tiles[i]!;
    const inBytes = rectByteLength(tile.input);
    const outBytes = rectByteLength(tile.output);
    if (inBytes > maxInputBytes) maxInputBytes = inBytes;
    if (outBytes > maxOutputBytes) maxOutputBytes = outBytes;
  }
  const sourceBuffer = sharedBufferPool.acquire(maxInputBytes);
  const outputBuffer = sharedBufferPool.acquire(maxOutputBytes);

  for (let i = 0; i < tiles.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const descriptor = tiles[i]!;

    // Read source tile into pooled buffer (zero-copy row extraction)
    const inputBytes = readTileIntoBuffer(
      input,
      descriptor.input,
      sourceBuffer,
    );

    // Process tile synchronously — reuse pooled output buffer
    const result = applyFilterToTile(
      { descriptor, rgba: sourceBuffer.subarray(0, inputBytes) },
      filter,
      outputBuffer,
    );

    // Write result directly into output image (inline sink)
    writeTileToOutput(output, result.descriptor.output, result.rgba);

    processedTiles += 1;
    outputBytes += result.rgba.length;
    options.onTile?.(descriptor);
    options.onProgress?.({
      tile: descriptor,
      completedTiles: processedTiles,
      totalTiles: tiles.length,
      percent: (processedTiles / tiles.length) * 100,
    });
  }

  // Return buffers to pool for reuse by subsequent processRawImage calls
  sharedBufferPool.release(sourceBuffer);
  sharedBufferPool.release(outputBuffer);

  return {
    totalTiles: tiles.length,
    processedTiles,
    outputBytes,
    elapsedMs: nowMs() - startedAtMs,
  };
}

/**
 * Reads tile data from a raw image into a pre-allocated buffer.
 * Returns the number of bytes written (= rect.width * rect.height * 4).
 */
function readTileIntoBuffer(
  image: RawRgbaImage,
  rect: Rect,
  buffer: Uint8Array,
): number {
  const rowBytes = rect.width * RGBA_CHANNELS;
  const totalBytes = rowBytes * rect.height;

  // Fast path: when the tile spans the full image width the rows are contiguous
  // in memory — one memcpy is enough (V8 optimises set(subarray) → memcpy).
  if (rect.width === image.width) {
    const sourceStart = rect.y * image.width * RGBA_CHANNELS;
    buffer.set(image.data.subarray(sourceStart, sourceStart + totalBytes));
    return totalBytes;
  }

  for (let row = 0; row < rect.height; row += 1) {
    const sourceStart = ((rect.y + row) * image.width + rect.x) * RGBA_CHANNELS;
    const destStart = row * rowBytes;
    buffer.set(
      image.data.subarray(sourceStart, sourceStart + rowBytes),
      destStart,
    );
  }

  return totalBytes;
}

/**
 * Writes tile result data directly into the output image buffer.
 * Inlined sink — no function call abstraction overhead.
 */
function writeTileToOutput(
  image: RawRgbaImage,
  rect: Rect,
  data: Uint8Array,
): void {
  const rowBytes = rect.width * RGBA_CHANNELS;

  // Fast path: contiguous write when tile spans the full image width.
  if (rect.width === image.width) {
    const targetStart = rect.y * image.width * RGBA_CHANNELS;
    image.data.set(data.subarray(0, rowBytes * rect.height), targetStart);
    return;
  }

  for (let row = 0; row < rect.height; row += 1) {
    const targetStart = ((rect.y + row) * image.width + rect.x) * RGBA_CHANNELS;
    const sourceStart = row * rowBytes;
    image.data.set(
      data.subarray(sourceStart, sourceStart + rowBytes),
      targetStart,
    );
  }
}

/**
 * Runs multiple filters in sequence. Uses double-buffered in-place processing
 * to eliminate intermediate image allocations — only 2 buffers are ever used
 * regardless of how many pipeline steps there are.
 */
export async function processRawImagePipeline(
  input: RawRgbaImage,
  steps: readonly ProcessPipelineStep[],
  options: Omit<ProcessOptions, "filter"> = {},
): Promise<RawRgbaImage> {
  if (steps.length === 0) {
    throw new PhantomError("At least one pipeline step is required.");
  }

  // Single step — no double-buffering needed
  if (steps.length === 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return processRawImage(input, mergeStepOptions(options, steps[0]!));
  }

  // Multi-step: use double-buffering to avoid allocating N images
  // Only 2 buffers (A and B) are used, ping-ponging between them.
  const bufferSize = input.width * input.height * RGBA_CHANNELS;
  const bufA: RawRgbaImage = {
    width: input.width,
    height: input.height,
    data: new Uint8Array(bufferSize),
  };
  const bufB: RawRgbaImage = {
    width: input.width,
    height: input.height,
    data: new Uint8Array(bufferSize),
  };

  // First step reads from input, writes to bufA
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const firstStep = steps[0]!;
  const firstOptions = resolveProcessOptions(
    mergeStepOptions(options, firstStep),
  );
  const firstTiles = planTiles({
    width: input.width,
    height: input.height,
    tileSize: firstOptions.tileSize,
    overlap: firstOptions.overlap,
  });
  processImageTilesSync(input, bufA, firstTiles, firstOptions.filter);

  // Subsequent steps alternate between bufA→bufB and bufB→bufA.
  // Reuse the previous tile plan when tileSize and overlap are unchanged —
  // planTiles is O(n) allocation + O(n) work, so caching saves N-1 redundant
  // calls in typical pipelines where geometry is constant across steps.
  let cachedTiles = firstTiles;
  let cachedTileSize = firstOptions.tileSize;
  let cachedOverlap = firstOptions.overlap;

  for (let s = 1; s < steps.length; s += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const step = steps[s]!;
    const stepOptions = resolveProcessOptions(mergeStepOptions(options, step));

    if (
      stepOptions.tileSize !== cachedTileSize ||
      stepOptions.overlap !== cachedOverlap
    ) {
      cachedTiles = planTiles({
        width: input.width,
        height: input.height,
        tileSize: stepOptions.tileSize,
        overlap: stepOptions.overlap,
      });
      cachedTileSize = stepOptions.tileSize;
      cachedOverlap = stepOptions.overlap;
    }

    if (s % 2 === 1) {
      processImageTilesSync(bufA, bufB, cachedTiles, stepOptions.filter);
    } else {
      processImageTilesSync(bufB, bufA, cachedTiles, stepOptions.filter);
    }
  }

  // Return whichever buffer has the final result
  return steps.length % 2 === 1 ? bufA : bufB;
}

/**
 * Ultra-fast synchronous tile processing — pre-allocates source and output
 * buffers once for the largest tile to eliminate per-tile allocation churn.
 */
function processImageTilesSync(
  input: RawRgbaImage,
  output: RawRgbaImage,
  tiles: readonly TileDescriptor[],
  filter: import("./types.js").PixelFilter,
): void {
  // Pre-allocate source and output buffers sized for the largest tile
  let maxInputBytes = 0;
  let maxOutputBytes = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const tile = tiles[i]!;
    const inBytes = rectByteLength(tile.input);
    const outBytes = rectByteLength(tile.output);
    if (inBytes > maxInputBytes) maxInputBytes = inBytes;
    if (outBytes > maxOutputBytes) maxOutputBytes = outBytes;
  }
  const sourceBuffer = new Uint8Array(maxInputBytes);
  const outputBuffer = new Uint8Array(maxOutputBytes);

  for (let i = 0; i < tiles.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const descriptor = tiles[i]!;
    const inputBytes = readTileIntoBuffer(
      input,
      descriptor.input,
      sourceBuffer,
    );
    const result = applyFilterToTile(
      { descriptor, rgba: sourceBuffer.subarray(0, inputBytes) },
      filter,
      outputBuffer,
    );
    writeTileToOutput(output, result.descriptor.output, result.rgba);
  }
}

/**
 * Processes an arbitrary tile source and sink. This is the decoder boundary:
 * compressed image decoders can implement `TileSource` without changing the
 * tile planner or kernels.
 */
export async function processTileSource(
  dimensions: { readonly width: number; readonly height: number },
  source: TileSource,
  sink: TileSink,
  options: ProcessOptions = {},
): Promise<void> {
  await processTileSourceWithStats(dimensions, source, sink, options);
}

/**
 * Processes an arbitrary tile source and sink while returning runtime stats.
 */
export async function processTileSourceWithStats(
  dimensions: { readonly width: number; readonly height: number },
  source: TileSource,
  sink: TileSink,
  options: ProcessOptions = {},
): Promise<ProcessStats> {
  const { tileSize, overlap, filter } = resolveProcessOptions(options);
  // Precedence: explicit option → registered global processor → CPU baseline
  const tileProcessor =
    options.tileProcessor ?? getRegisteredProcessor() ?? cpuTileProcessor;
  const tiles = planTiles({
    width: dimensions.width,
    height: dimensions.height,
    tileSize,
    overlap,
  });
  const startedAtMs = nowMs();
  let processedTiles = 0;
  let outputBytes = 0;

  for (const descriptor of tiles) {
    options.signal?.throwIfAborted();
    const rgba = await source.read(descriptor.input);
    validateSourceTile(rgba, descriptor);
    const result = await tileProcessor.processTile(
      { descriptor, rgba },
      filter,
    );
    validateTileResult(result, descriptor, tileProcessor.id);
    await sink.write(result.descriptor.output, result.rgba);
    processedTiles += 1;
    outputBytes += result.rgba.length;
    options.onTile?.(descriptor);
    options.onProgress?.({
      tile: descriptor,
      completedTiles: processedTiles,
      totalTiles: tiles.length,
      percent: (processedTiles / tiles.length) * 100,
    });
  }

  return {
    totalTiles: tiles.length,
    processedTiles,
    outputBytes,
    elapsedMs: nowMs() - startedAtMs,
  };
}

export function createRawTileSource(image: RawRgbaImage): TileSource {
  assertRgbaLength(image);

  return {
    read(rect: Rect): Uint8Array {
      assertRectWithinImage(rect, image);

      const rowBytes = rect.width * RGBA_CHANNELS;
      const output = new Uint8Array(rowBytes * rect.height);
      for (let row = 0; row < rect.height; row += 1) {
        const sourceStart =
          ((rect.y + row) * image.width + rect.x) * RGBA_CHANNELS;
        output.set(
          image.data.subarray(sourceStart, sourceStart + rowBytes),
          row * rowBytes,
        );
      }
      return output;
    },
  };
}

export function createRawTileSink(image: RawRgbaImage): TileSink {
  assertRgbaLength(image);

  return {
    write(rect: Rect, data: Uint8Array): void {
      assertRectWithinImage(rect, image);
      const expected = rectByteLength(rect);
      if (data.length !== expected) {
        throw new PhantomError(
          `Output tile length mismatch: expected ${expected}, got ${data.length}.`,
        );
      }

      const rowBytes = rect.width * RGBA_CHANNELS;
      for (let row = 0; row < rect.height; row += 1) {
        const targetStart =
          ((rect.y + row) * image.width + rect.x) * RGBA_CHANNELS;
        const sourceStart = row * rowBytes;
        image.data.set(
          data.subarray(sourceStart, sourceStart + rowBytes),
          targetStart,
        );
      }
    },
  };
}

function assertRectWithinImage(rect: Rect, image: RawRgbaImage): void {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > image.width ||
    rect.y + rect.height > image.height
  ) {
    throw new PhantomError(
      `Rectangle is outside image bounds: ${JSON.stringify(rect)}.`,
    );
  }
}

function resolveProcessOptions(
  options: ProcessOptions,
): Required<Pick<ProcessOptions, "tileSize" | "overlap" | "filter">> {
  const filter = options.filter ?? "identity";
  getPixelFilterProfile(filter);

  const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const requiredOverlap = getPixelFilterOverlap(filter);

  if (overlap < requiredOverlap) {
    throw new PhantomError(
      `${filter} requires overlap of at least ${requiredOverlap}.`,
    );
  }

  return { tileSize, overlap, filter };
}

function validateTileResult(
  result: TileResult,
  descriptor: TileDescriptor,
  processorId: string,
): void {
  if (
    result.descriptor.index !== descriptor.index ||
    !sameRect(result.descriptor.input, descriptor.input) ||
    !sameRect(result.descriptor.output, descriptor.output)
  ) {
    throw new PhantomError(
      `Tile processor ${processorId} returned a descriptor that does not match tile ${descriptor.index}.`,
    );
  }

  const expected = rectByteLength(descriptor.output);
  if (result.rgba.length !== expected) {
    throw new PhantomError(
      `Tile processor ${processorId} returned ${result.rgba.length} bytes for tile ${descriptor.index}; expected ${expected}.`,
    );
  }
}

function validateSourceTile(
  rgba: Uint8Array,
  descriptor: TileDescriptor,
): void {
  const expected = rectByteLength(descriptor.input);
  if (rgba.length !== expected) {
    throw new PhantomError(
      `Tile source returned ${rgba.length} bytes for tile ${descriptor.index}; expected ${expected}.`,
    );
  }
}

function sameRect(left: Rect, right: Rect): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function mergeStepOptions(
  base: Omit<ProcessOptions, "filter">,
  step: ProcessPipelineStep,
): ProcessOptions {
  const merged: ProcessOptions = {
    ...base,
    filter: step.filter,
  };
  if (step.tileSize !== undefined) {
    (merged as { tileSize?: number }).tileSize = step.tileSize;
  }
  if (step.overlap !== undefined) {
    (merged as { overlap?: number }).overlap = step.overlap;
  }
  return merged;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
