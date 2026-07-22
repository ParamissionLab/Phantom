import { planTiles, rectByteLength } from "./tiling.js";
import {
  PhantomError,
  RGBA_CHANNELS,
  type ImageDimensions,
  type PixelFilter,
} from "./types.js";

export interface MemoryBudget {
  readonly maxBytes: number;
  readonly overlap: number;
  readonly minTileSize?: number;
  readonly maxTileSize?: number;
}

export interface ProcessingPlanStats {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly filter: PixelFilter;
  readonly tileSize: number;
  readonly overlap: number;
  readonly tileCount: number;
  readonly fullFrameBytes: number;
  readonly peakTileBytes: number;
  readonly estimatedScratchBytes: number;
  readonly memoryReductionRatio: number;
}

const DEFAULT_MAX_TILE_SIZE = 4096;
const DEFAULT_MIN_TILE_SIZE = 256;

/**
 * Returns raw RGBA footprint without allocating the image.
 */
export function estimateRgbaBytes(dimensions: ImageDimensions): number {
  assertDimensions(dimensions);
  return dimensions.width * dimensions.height * RGBA_CHANNELS;
}

/**
 * Picks the largest power-of-two tile size that fits a per-worker memory budget.
 */
export function chooseTileSize(budget: MemoryBudget): number {
  if (!Number.isFinite(budget.maxBytes) || budget.maxBytes <= 0) {
    throw new PhantomError("maxBytes must be a positive finite number.");
  }

  const minTileSize = budget.minTileSize ?? DEFAULT_MIN_TILE_SIZE;
  const maxTileSize = budget.maxTileSize ?? DEFAULT_MAX_TILE_SIZE;
  if (minTileSize > maxTileSize) {
    throw new PhantomError("minTileSize must not exceed maxTileSize.");
  }
  let tileSize = maxTileSize;

  while (estimateTileScratchBytes(tileSize, budget.overlap) > budget.maxBytes) {
    const halved = Math.floor(tileSize / 2);
    // Halving can undershoot minTileSize when it is not a power of two; clamp
    // instead of returning a tile smaller than the caller's floor.
    if (halved < minTileSize) {
      tileSize = minTileSize;
      break;
    }
    tileSize = halved;
  }

  if (estimateTileScratchBytes(tileSize, budget.overlap) > budget.maxBytes) {
    throw new PhantomError(
      "Memory budget is too small for the minimum tile size.",
    );
  }

  return tileSize;
}

/**
 * Estimates input plus output RGBA tile memory for one worker lane.
 */
export function estimateTileScratchBytes(
  tileSize: number,
  overlap: number,
): number {
  if (!Number.isInteger(tileSize) || tileSize <= 0) {
    throw new PhantomError("tileSize must be a positive integer.");
  }
  if (!Number.isInteger(overlap) || overlap < 0) {
    throw new PhantomError("overlap must be a non-negative integer.");
  }

  const expanded = tileSize + overlap * 2;
  return (expanded * expanded + tileSize * tileSize) * RGBA_CHANNELS;
}

/**
 * Returns full tiling and memory stats for a huge-image processing job
 * without allocating full-frame memory.
 */
export function getProcessingPlan(
  dimensions: ImageDimensions,
  options: {
    readonly tileSize: number;
    readonly overlap: number;
    readonly filter?: PixelFilter;
    readonly workerLanes?: number;
  },
): ProcessingPlanStats {
  assertDimensions(dimensions);
  const filter = options.filter ?? "sharpen3x3";
  const tiles = planTiles({
    width: dimensions.width,
    height: dimensions.height,
    tileSize: options.tileSize,
    overlap: options.overlap,
  });
  // Reduce with a loop, not Math.max(...spread): a gigapixel plan produces
  // hundreds of thousands of tiles and spreading them as call arguments
  // overflows the JS argument limit (RangeError) — exactly the workload this
  // library targets.
  let peakTileBytes = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const tile = tiles[i]!;
    const bytes = rectByteLength(tile.input) + rectByteLength(tile.output);
    if (bytes > peakTileBytes) peakTileBytes = bytes;
  }
  const workerLanes = Math.max(1, options.workerLanes ?? 1);
  const fullFrameBytes = estimateRgbaBytes(dimensions);
  const estimatedScratchBytes = peakTileBytes * workerLanes;

  return {
    width: dimensions.width,
    height: dimensions.height,
    pixels: dimensions.width * dimensions.height,
    filter,
    tileSize: options.tileSize,
    overlap: options.overlap,
    tileCount: tiles.length,
    fullFrameBytes,
    peakTileBytes,
    estimatedScratchBytes,
    memoryReductionRatio: fullFrameBytes / estimatedScratchBytes,
  };
}

function assertDimensions(dimensions: ImageDimensions): void {
  if (!Number.isInteger(dimensions.width) || dimensions.width <= 0) {
    throw new PhantomError("width must be a positive integer.");
  }
  if (!Number.isInteger(dimensions.height) || dimensions.height <= 0) {
    throw new PhantomError("height must be a positive integer.");
  }
}
