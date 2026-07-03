import { applyFilterToTile } from "./kernels.js";
import { getPixelFilterOverlap, getPixelFilterProfile } from "./filters.js";
import { planTiles, rectByteLength } from "./tiling.js";
import {
  PhantomError,
  RGBA_CHANNELS,
  type ProcessPipelineStep,
  type ProcessOptions,
  type ProcessStats,
  type RawRgbaProcessResult,
  type RawRgbaImage,
  type Rect,
  type PixelFilter,
  type TileDescriptor,
  type TileSink,
  type TileSource,
  type TileKernelBackend,
  type TileResult,
  type BackendFailureMode,
  assertRgbaLength,
} from "./types.js";

const DEFAULT_TILE_SIZE = 512;
const DEFAULT_OVERLAP = 1;

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

  const output: RawRgbaImage = {
    width: input.width,
    height: input.height,
    data: new Uint8Array(input.data.length),
  };

  const stats = await processTileSourceWithStats(
    { width: input.width, height: input.height },
    createRawTileSource(input),
    createRawTileSink(output),
    options,
  );

  return { image: output, stats };
}

/**
 * Runs multiple filters in sequence without making callers manually pass the
 * output of one step into the next.
 */
export async function processRawImagePipeline(
  input: RawRgbaImage,
  steps: readonly ProcessPipelineStep[],
  options: Omit<ProcessOptions, "filter"> = {},
): Promise<RawRgbaImage> {
  if (steps.length === 0) {
    throw new PhantomError("At least one pipeline step is required.");
  }

  let current = input;
  for (const step of steps) {
    current = await processRawImage(current, mergeStepOptions(options, step));
  }

  return current;
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
  const { tileSize, overlap, filter, backendFailureMode } =
    resolveProcessOptions(options);
  const tiles = planTiles({
    width: dimensions.width,
    height: dimensions.height,
    tileSize,
    overlap,
  });
  const startedAtMs = nowMs();
  let processedTiles = 0;
  let backendTiles = 0;
  let fallbackTiles = 0;
  let outputBytes = 0;

  for (const descriptor of tiles) {
    options.signal?.throwIfAborted();
    const rgba = await source.read(descriptor.input);
    const result = applyFilterWithBackend(
      descriptor,
      rgba,
      filter,
      options.backend,
      backendFailureMode,
    );
    await sink.write(result.descriptor.output, result.rgba);
    processedTiles += 1;
    if (result.backendUsed) {
      backendTiles += 1;
    } else if (options.backend !== undefined) {
      fallbackTiles += 1;
    }
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
    backendTiles,
    fallbackTiles,
    outputBytes,
    elapsedMs: nowMs() - startedAtMs,
  };
}

interface AppliedTileResult extends TileResult {
  readonly backendUsed: boolean;
}

function applyFilterWithBackend(
  descriptor: TileDescriptor,
  rgba: Uint8Array,
  filter: PixelFilter,
  backend: TileKernelBackend | undefined,
  backendFailureMode: BackendFailureMode,
): AppliedTileResult {
  if (backend === undefined) {
    return {
      ...applyFilterToTile({ descriptor, rgba }, filter),
      backendUsed: false,
    };
  }

  if (backend.supportsFilter?.(filter) === false) {
    if (backendFailureMode === "fallback") {
      return {
        ...applyFilterToTile({ descriptor, rgba }, filter),
        backendUsed: false,
      };
    }
    throw new PhantomError(
      `Backend ${backend.id ?? "tile-kernel"} does not support filter: ${filter}.`,
    );
  }

  const outputOffsetX = descriptor.output.x - descriptor.input.x;
  const outputOffsetY = descriptor.output.y - descriptor.input.y;
  try {
    const output = backend.processTile(
      rgba,
      descriptor.input.width,
      descriptor.input.height,
      outputOffsetX,
      outputOffsetY,
      descriptor.output.width,
      descriptor.output.height,
      filter,
    );
    const expectedOutputBytes = rectByteLength(descriptor.output);
    if (output.length !== expectedOutputBytes) {
      throw new PhantomError(
        `Backend ${backend.id ?? "tile-kernel"} returned ${output.length} bytes for tile ${descriptor.index}; expected ${expectedOutputBytes}.`,
      );
    }
    return { descriptor, rgba: output, backendUsed: true };
  } catch (error) {
    if (backendFailureMode === "fallback") {
      return {
        ...applyFilterToTile({ descriptor, rgba }, filter),
        backendUsed: false,
      };
    }
    if (error instanceof PhantomError) {
      throw error;
    }
    throw new PhantomError(
      `Backend ${backend.id ?? "tile-kernel"} failed on tile ${descriptor.index}: ${formatUnknownError(error)}.`,
    );
  }
}

export function createRawTileSource(image: RawRgbaImage): TileSource {
  assertRgbaLength(image);

  return {
    read(rect: Rect): Uint8Array {
      assertRectWithinImage(rect, image);

      const output = new Uint8Array(rectByteLength(rect));
      for (let row = 0; row < rect.height; row += 1) {
        const sourceStart =
          ((rect.y + row) * image.width + rect.x) * RGBA_CHANNELS;
        const sourceEnd = sourceStart + rect.width * RGBA_CHANNELS;
        const outputStart = row * rect.width * RGBA_CHANNELS;
        output.set(image.data.subarray(sourceStart, sourceEnd), outputStart);
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

      for (let row = 0; row < rect.height; row += 1) {
        const targetStart =
          ((rect.y + row) * image.width + rect.x) * RGBA_CHANNELS;
        const sourceStart = row * rect.width * RGBA_CHANNELS;
        const sourceEnd = sourceStart + rect.width * RGBA_CHANNELS;
        image.data.set(data.subarray(sourceStart, sourceEnd), targetStart);
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
): Required<
  Pick<ProcessOptions, "tileSize" | "overlap" | "filter" | "backendFailureMode">
> {
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

  const backendFailureMode = options.backendFailureMode ?? "strict";
  if (backendFailureMode !== "strict" && backendFailureMode !== "fallback") {
    throw new PhantomError("backendFailureMode must be strict or fallback.");
  }

  return { tileSize, overlap, filter, backendFailureMode };
}

function mergeStepOptions(
  options: Omit<ProcessOptions, "filter">,
  step: ProcessPipelineStep,
): ProcessOptions {
  return {
    ...options,
    ...(step.tileSize === undefined ? {} : { tileSize: step.tileSize }),
    ...(step.overlap === undefined ? {} : { overlap: step.overlap }),
    filter: step.filter,
  };
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
