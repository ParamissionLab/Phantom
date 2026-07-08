import { PhantomError, type RawRgbaImage, assertRgbaLength } from "./types.js";

export type WatermarkPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type WatermarkTileMode = "none" | "tile";

export interface TextWatermarkOptions {
  /** Watermark text content */
  readonly text: string;
  /** Font CSS string, e.g. "bold 48px Arial" */
  readonly font?: string;
  /** Text fill color (CSS color string), default "rgba(255,255,255,0.6)" */
  readonly color?: string;
  /** Opacity multiplier 0.0–1.0 applied on top of the color's alpha */
  readonly opacity?: number;
  /** Position preset */
  readonly position?: WatermarkPosition;
  /** Pixel margin from the edge for positioned watermarks, default 24 */
  readonly margin?: number;
  /** Rotation in degrees (clockwise), default 0 */
  readonly rotation?: number;
  /** Whether to tile the watermark across the image */
  readonly tileMode?: WatermarkTileMode;
  /** Tile spacing in pixels when tileMode is "tile", default 200 */
  readonly tileSpacing?: number;
}

export interface WatermarkResult {
  readonly image: RawRgbaImage;
  /** The canvas used for compositing (available for inspection) */
  readonly watermarkCanvas: HTMLCanvasElement;
}

/**
 * Composites a text watermark onto a raw RGBA image using a browser canvas.
 * Returns a new image with the watermark burned in.
 *
 * Requires a browser with Canvas API support.
 */
export function applyTextWatermark(
  image: RawRgbaImage,
  options: TextWatermarkOptions,
): WatermarkResult {
  assertRgbaLength(image);
  assertWatermarkOptions(options);

  const font = options.font ?? "bold 48px Arial, sans-serif";
  const color = options.color ?? "rgba(255,255,255,0.6)";
  const opacity = options.opacity ?? 1.0;
  const position = options.position ?? "bottom-right";
  const margin = options.margin ?? 24;
  const rotation = options.rotation ?? 0;
  const tileMode = options.tileMode ?? "none";
  const tileSpacing = options.tileSpacing ?? 200;

  if (typeof document === "undefined" || typeof HTMLCanvasElement === "undefined") {
    throw new PhantomError("applyTextWatermark requires a browser Canvas API.");
  }

  // Create working canvas from image
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (ctx === null) {
    throw new PhantomError("2D canvas context is unavailable.");
  }

  // Draw source image
  const imageData = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  ctx.putImageData(imageData, 0, 0);

  // Configure watermark style
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const metrics = ctx.measureText(options.text);
  const textWidth = metrics.width;
  const textHeight = parseInt(font, 10) || 48;

  if (tileMode === "tile") {
    // Tile the watermark across the entire image
    const stepX = textWidth + tileSpacing;
    const stepY = textHeight + tileSpacing;
    const angleRad = (rotation * Math.PI) / 180;

    ctx.translate(image.width / 2, image.height / 2);
    ctx.rotate(angleRad);

    const diagonal = Math.ceil(Math.sqrt(image.width ** 2 + image.height ** 2));
    for (let y = -diagonal; y < diagonal; y += stepY) {
      for (let x = -diagonal; x < diagonal; x += stepX) {
        ctx.fillText(options.text, x, y);
      }
    }
  } else {
    // Positioned watermark
    const [x, y] = resolvePosition(position, image.width, image.height, textWidth, textHeight, margin);
    ctx.translate(x, y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.fillText(options.text, 0, 0);
  }

  ctx.restore();

  // Read back the composited image
  const resultData = ctx.getImageData(0, 0, image.width, image.height);
  const outputData = new Uint8Array(resultData.data.buffer);

  return {
    image: { width: image.width, height: image.height, data: outputData },
    watermarkCanvas: canvas,
  };
}

// ---------------------------------------------------------------------------
// Position resolver
// ---------------------------------------------------------------------------

function resolvePosition(
  position: WatermarkPosition,
  imageWidth: number,
  imageHeight: number,
  textWidth: number,
  textHeight: number,
  margin: number,
): [number, number] {
  const halfW = textWidth / 2;
  const halfH = textHeight / 2;

  switch (position) {
    case "top-left":
      return [margin + halfW, margin + halfH];
    case "top-center":
      return [imageWidth / 2, margin + halfH];
    case "top-right":
      return [imageWidth - margin - halfW, margin + halfH];
    case "center-left":
      return [margin + halfW, imageHeight / 2];
    case "center":
      return [imageWidth / 2, imageHeight / 2];
    case "center-right":
      return [imageWidth - margin - halfW, imageHeight / 2];
    case "bottom-left":
      return [margin + halfW, imageHeight - margin - halfH];
    case "bottom-center":
      return [imageWidth / 2, imageHeight - margin - halfH];
    case "bottom-right":
      return [imageWidth - margin - halfW, imageHeight - margin - halfH];
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertWatermarkOptions(options: TextWatermarkOptions): void {
  if (!options.text || options.text.trim().length === 0) {
    throw new PhantomError("Watermark text must not be empty.");
  }
  if (options.opacity !== undefined && (options.opacity < 0 || options.opacity > 1)) {
    throw new PhantomError("opacity must be between 0.0 and 1.0.");
  }
  if (options.margin !== undefined && options.margin < 0) {
    throw new PhantomError("margin must be non-negative.");
  }
}
