/* eslint-disable @typescript-eslint/no-non-null-assertion */
// ^ Disabled for this file: all typed-array indices are pre-validated bounds
// within assertRgbaLength + the loop stride. Using ?? 0 would add branches
// per pixel in hot LUT and HSL loops.
import {
  PhantomError,
  RGBA_CHANNELS,
  type RawRgbaImage,
  assertRgbaLength,
} from "./types.js";
import { clampU8 } from "./fixed-point.js";

/**
 * Per-channel image adjustment options. All values use natural units:
 * - brightness: -100 to +100 (0 = no change)
 * - contrast: -100 to +100 (0 = no change)
 * - saturation: -100 to +100 (0 = no change, -100 = grayscale, +100 = vivid)
 * - temperature: -100 to +100 (negative = cooler/blue, positive = warmer/orange)
 * - hue: -180 to +180 degrees rotation
 * - gamma: 0.1 to 5.0 (1.0 = no change, < 1 = lighten shadows, > 1 = darken)
 */
export interface ImageAdjustOptions {
  /** Additive brightness shift: -100 to +100 */
  readonly brightness?: number;
  /** S-curve contrast adjustment: -100 to +100 */
  readonly contrast?: number;
  /** Saturation multiplier: -100 to +100 */
  readonly saturation?: number;
  /** Color temperature: -100 (cool) to +100 (warm) */
  readonly temperature?: number;
  /** Hue rotation in degrees: -180 to +180 */
  readonly hue?: number;
  /** Gamma exponent: 0.1 to 5.0, default 1.0 */
  readonly gamma?: number;
}

/**
 * Applies non-destructive tone and color adjustments to a raw RGBA image.
 * All channels are processed in a single pass using precomputed LUTs for speed.
 * Alpha is preserved unchanged.
 */
export function adjustRawImage(
  image: RawRgbaImage,
  options: ImageAdjustOptions,
): RawRgbaImage {
  assertRgbaLength(image);
  assertAdjustOptions(options);

  const brightness = options.brightness ?? 0;
  const contrast = options.contrast ?? 0;
  const saturation = options.saturation ?? 0;
  const temperature = options.temperature ?? 0;
  const hue = options.hue ?? 0;
  const gamma = options.gamma ?? 1.0;

  // Fast path: nothing to do
  if (
    brightness === 0 &&
    contrast === 0 &&
    saturation === 0 &&
    temperature === 0 &&
    hue === 0 &&
    gamma === 1.0
  ) {
    return {
      width: image.width,
      height: image.height,
      data: new Uint8Array(image.data),
    };
  }

  // Build per-channel 256-entry LUTs for brightness/contrast/gamma (no hue/sat — those need HSL)
  const needHslPath = saturation !== 0 || hue !== 0;

  // LUTs: brightnessContrast + temperature applied per-channel
  const brightnessShift = Math.round((brightness / 100) * 127);
  const contrastFactor =
    contrast === 0
      ? 1.0
      : contrast > 0
        ? 1 + (contrast / 100) * 2 // positive: 1..3
        : 1 + contrast / 100; // negative: 0..1
  const tempR = Math.round((temperature / 100) * 30); // warm adds red
  const tempB = Math.round((-temperature / 100) * 30); // warm removes blue

  const lutR = buildLut(brightnessShift + tempR, contrastFactor, gamma);
  const lutG = buildLut(brightnessShift, contrastFactor, gamma);
  const lutB = buildLut(brightnessShift + tempB, contrastFactor, gamma);

  const output = new Uint8Array(image.data.length);

  if (!needHslPath) {
    // Fast LUT-only path: 3 table lookups per pixel
    for (let i = 0; i < image.data.length; i += RGBA_CHANNELS) {
      output[i] = lutR[image.data[i]!]!;
      output[i + 1] = lutG[image.data[i + 1]!]!;
      output[i + 2] = lutB[image.data[i + 2]!]!;
      output[i + 3] = image.data[i + 3]!;
    }
  } else {
    // HSL path: convert to HSL, apply hue/sat, convert back, then apply LUTs
    const satScale = 1 + saturation / 100;
    const hueRad = (hue / 180) * Math.PI;

    for (let i = 0; i < image.data.length; i += RGBA_CHANNELS) {
      const r = image.data[i]! / 255;
      const g = image.data[i + 1]! / 255;
      const b = image.data[i + 2]! / 255;

      const [h, s, l] = rgbToHsl(r, g, b);
      const newH = (((h + hueRad / (2 * Math.PI)) % 1) + 1) % 1;
      const newS = Math.min(1, Math.max(0, s * satScale));
      const [nr, ng, nb] = hslToRgb(newH, newS, l);

      output[i] = lutR[clampU8(Math.round(nr * 255))]!;
      output[i + 1] = lutG[clampU8(Math.round(ng * 255))]!;
      output[i + 2] = lutB[clampU8(Math.round(nb * 255))]!;
      output[i + 3] = image.data[i + 3]!;
    }
  }

  return { width: image.width, height: image.height, data: output };
}

// ---------------------------------------------------------------------------
// LUT builder
// ---------------------------------------------------------------------------

function buildLut(
  brightnessShift: number,
  contrastFactor: number,
  gamma: number,
): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    let v = i / 255;
    // Apply gamma
    if (gamma !== 1.0) {
      v = Math.pow(v, gamma);
    }
    // Apply contrast (centered on 0.5)
    v = (v - 0.5) * contrastFactor + 0.5;
    // Apply brightness
    v += brightnessShift / 255;
    lut[i] = clampU8(Math.round(v * 255));
  }
  return lut;
}

// ---------------------------------------------------------------------------
// HSL conversions
// ---------------------------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;

  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    return [l, l, l];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    hueToRgbChannel(p, q, h + 1 / 3),
    hueToRgbChannel(p, q, h),
    hueToRgbChannel(p, q, h - 1 / 3),
  ];
}

function hueToRgbChannel(p: number, q: number, t: number): number {
  const tn = ((t % 1) + 1) % 1;
  if (tn < 1 / 6) return p + (q - p) * 6 * tn;
  if (tn < 1 / 2) return q;
  if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
  return p;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertAdjustOptions(options: ImageAdjustOptions): void {
  if (
    options.brightness !== undefined &&
    (options.brightness < -100 || options.brightness > 100)
  ) {
    throw new PhantomError("brightness must be between -100 and 100.");
  }
  if (
    options.contrast !== undefined &&
    (options.contrast < -100 || options.contrast > 100)
  ) {
    throw new PhantomError("contrast must be between -100 and 100.");
  }
  if (
    options.saturation !== undefined &&
    (options.saturation < -100 || options.saturation > 100)
  ) {
    throw new PhantomError("saturation must be between -100 and 100.");
  }
  if (
    options.temperature !== undefined &&
    (options.temperature < -100 || options.temperature > 100)
  ) {
    throw new PhantomError("temperature must be between -100 and 100.");
  }
  if (options.hue !== undefined && (options.hue < -180 || options.hue > 180)) {
    throw new PhantomError("hue must be between -180 and 180 degrees.");
  }
  if (
    options.gamma !== undefined &&
    (options.gamma < 0.1 || options.gamma > 5.0)
  ) {
    throw new PhantomError("gamma must be between 0.1 and 5.0.");
  }
}
