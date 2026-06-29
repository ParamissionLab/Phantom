import {
  PhantomError,
  type Rect,
  type TileDescriptor,
  assertPositiveInteger,
} from "./types.js";

export interface TilePlanOptions {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly overlap: number;
}

export function clampRect(
  rect: Rect,
  bounds: { readonly width: number; readonly height: number },
): Rect {
  const x = clamp(rect.x, 0, bounds.width);
  const y = clamp(rect.y, 0, bounds.height);
  const right = clamp(rect.x + rect.width, 0, bounds.width);
  const bottom = clamp(rect.y + rect.height, 0, bounds.height);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

/**
 * Creates output tiles and their overlap-expanded input rectangles.
 */
export function planTiles(options: TilePlanOptions): TileDescriptor[] {
  const { width, height, tileSize, overlap } = options;
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");
  assertPositiveInteger(tileSize, "tileSize");

  if (!Number.isInteger(overlap) || overlap < 0) {
    throw new PhantomError("overlap must be a non-negative integer.");
  }
  if (overlap >= tileSize) {
    throw new PhantomError("overlap must be smaller than tileSize.");
  }

  const tiles: TileDescriptor[] = [];
  let index = 0;

  for (let y = 0; y < height; y += tileSize) {
    for (let x = 0; x < width; x += tileSize) {
      const output = clampRect(
        { x, y, width: tileSize, height: tileSize },
        { width, height },
      );
      const input = clampRect(
        {
          x: output.x - overlap,
          y: output.y - overlap,
          width: output.width + overlap * 2,
          height: output.height + overlap * 2,
        },
        { width, height },
      );

      tiles.push({ index, input, output });
      index += 1;
    }
  }

  return tiles;
}

export function rectByteLength(rect: Rect, channels = 4): number {
  assertPositiveInteger(rect.width, "rect.width");
  assertPositiveInteger(rect.height, "rect.height");
  assertPositiveInteger(channels, "channels");
  return rect.width * rect.height * channels;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
