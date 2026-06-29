export const RGBA_CHANNELS = 4;

export type PixelFilter =
  "identity" | "invert" | "grayscale" | "smoothEnhance" | "sharpen3x3";

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends ImageDimensions {
  readonly x: number;
  readonly y: number;
}

export interface TileDescriptor {
  readonly index: number;
  readonly input: Rect;
  readonly output: Rect;
}

export interface RawRgbaImage extends ImageDimensions {
  readonly data: Uint8Array;
}

export interface TilePayload {
  readonly descriptor: TileDescriptor;
  readonly rgba: Uint8Array;
}

export interface TileResult {
  readonly descriptor: TileDescriptor;
  readonly rgba: Uint8Array;
}

export interface ProcessProgress {
  readonly tile: TileDescriptor;
  readonly completedTiles: number;
  readonly totalTiles: number;
  readonly percent: number;
}

export interface ProcessStats {
  readonly totalTiles: number;
  readonly processedTiles: number;
  readonly outputBytes: number;
  readonly elapsedMs: number;
}

export interface RawRgbaProcessResult {
  readonly image: RawRgbaImage;
  readonly stats: ProcessStats;
}

export interface ProcessPipelineStep {
  readonly filter: PixelFilter;
  readonly tileSize?: number;
  readonly overlap?: number;
}

export interface ProcessOptions {
  readonly tileSize?: number;
  readonly overlap?: number;
  readonly filter?: PixelFilter;
  readonly signal?: AbortSignal;
  readonly onTile?: (tile: TileDescriptor) => void;
  readonly onProgress?: (progress: ProcessProgress) => void;
}

export interface TileSource {
  read(rect: Rect): Promise<Uint8Array> | Uint8Array;
}

export interface TileSink {
  write(rect: Rect, data: Uint8Array): Promise<void> | void;
}

export interface StreamBufferOptions {
  readonly capacityBytes?: number;
  readonly signal?: AbortSignal;
}

export class PhantomError extends Error {
  public override readonly name = "PhantomError";
}

export function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new PhantomError(`${name} must be a positive integer.`);
  }
}

export function assertRgbaLength(image: RawRgbaImage): void {
  assertPositiveInteger(image.width, "width");
  assertPositiveInteger(image.height, "height");

  const expected = image.width * image.height * RGBA_CHANNELS;
  if (image.data.length !== expected) {
    throw new PhantomError(
      `RGBA buffer length mismatch: expected ${expected} bytes, got ${image.data.length}.`,
    );
  }
}
