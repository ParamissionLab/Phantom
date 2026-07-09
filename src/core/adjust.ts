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
    // Hue + saturation path — replaces per-pixel HSL round-trip with a
    // precomputed 3×3 fixed-point matrix (hue rotation × saturation scaling).
    //
    // Hue rotation around the achromatic axis (1,1,1)/√3 by angle θ:
    //   M_hue = I·cosθ + (1-cosθ)·(1/3)·ones + sinθ·cross_product_matrix
    // Saturation scaling (lerp toward luma):
    //   M_sat = satScale·I + (1-satScale)·luma_row_vector
    //
    // Combined M = M_sat × M_hue (applied as integer fixed-point multiply-shifts).
    // Precomputed once (256 multiplies), then 9 fixed-point multiplies per pixel
    // instead of full HSL round-trip (dozens of floats + branches + trig).
    const m = buildHueSatMatrix(hue, saturation);
    // m = [m00,m01,m02, m10,m11,m12, m20,m21,m22] — row-major, fixed-point Q8

    for (let i = 0; i < image.data.length; i += RGBA_CHANNELS) {
      const r = image.data[i]!;
      const g = image.data[i + 1]!;
      const b = image.data[i + 2]!;

      // Apply 3×3 matrix in fixed-point Q8 (>> 8 divides by 256)
      const nr = clampU8((m[0]! * r + m[1]! * g + m[2]! * b) >> 8);
      const ng = clampU8((m[3]! * r + m[4]! * g + m[5]! * b) >> 8);
      const nb = clampU8((m[6]! * r + m[7]! * g + m[8]! * b) >> 8);

      output[i] = lutR[nr]!;
      output[i + 1] = lutG[ng]!;
      output[i + 2] = lutB[nb]!;
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
// Hue + saturation — combined 3×3 fixed-point matrix
// ---------------------------------------------------------------------------
//
// Hue rotation in RGB space: rotate around the achromatic axis (1,1,1)/√3.
// Using Rodrigues' rotation formula for axis u=(1,1,1)/√3 and angle θ:
//
//   M_hue[i][j] = cosθ·δij + (1-cosθ)·(1/3) + sinθ·ε_ijk·(1/√3)
//
// Cross-product matrix for u=(1,1,1)/√3:
//   [  0  -1/√3  1/√3 ]
//   [ 1/√3  0   -1/√3 ]
//   [-1/√3  1/√3  0   ]
//
// Saturation scaling (mix toward perceived luma using BT.601 weights):
//   luma = 0.299r + 0.587g + 0.114b
//   out_ch = luma + (in_ch - luma) * satScale
//         = satScale·in_ch + (1-satScale)·luma·ones_vec
//
// M_sat = satScale·I + (1-satScale)·[0.299, 0.587, 0.114; ...]
//
// Combined: M = M_sat × M_hue (float → then encode as Q8 integer, ×256)
//
function buildHueSatMatrix(hueDeg: number, saturation: number): Int32Array {
  const theta = (hueDeg / 180) * Math.PI;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const inv3 = 1 / 3;
  const k = sinT / Math.sqrt(3);

  // 3×3 hue rotation matrix (row-major)
  const h00 = cosT + (1 - cosT) * inv3;
  const h01 = (1 - cosT) * inv3 - k;
  const h02 = (1 - cosT) * inv3 + k;
  const h10 = (1 - cosT) * inv3 + k;
  const h11 = cosT + (1 - cosT) * inv3;
  const h12 = (1 - cosT) * inv3 - k;
  const h20 = (1 - cosT) * inv3 - k;
  const h21 = (1 - cosT) * inv3 + k;
  const h22 = cosT + (1 - cosT) * inv3;

  // Saturation scaling: out = satScale * color + (1 - satScale) * luma
  // BT.601 luma weights
  const LR = 0.299;
  const LG = 0.587;
  const LB = 0.114;
  const satScale = Math.max(0, 1 + saturation / 100);
  const oneMinusSat = 1 - satScale;

  // M_sat rows: [satScale + (1-satScale)*Lx, (1-satScale)*Ly, ...]
  const s00 = satScale + oneMinusSat * LR;
  const s01 = oneMinusSat * LG;
  const s02 = oneMinusSat * LB;
  const s10 = oneMinusSat * LR;
  const s11 = satScale + oneMinusSat * LG;
  const s12 = oneMinusSat * LB;
  const s20 = oneMinusSat * LR;
  const s21 = oneMinusSat * LG;
  const s22 = satScale + oneMinusSat * LB;

  // Combined M = M_sat × M_hue
  const SCALE = 256; // Q8 fixed-point
  const m = new Int32Array(9);
  m[0] = Math.round((s00 * h00 + s01 * h10 + s02 * h20) * SCALE);
  m[1] = Math.round((s00 * h01 + s01 * h11 + s02 * h21) * SCALE);
  m[2] = Math.round((s00 * h02 + s01 * h12 + s02 * h22) * SCALE);
  m[3] = Math.round((s10 * h00 + s11 * h10 + s12 * h20) * SCALE);
  m[4] = Math.round((s10 * h01 + s11 * h11 + s12 * h21) * SCALE);
  m[5] = Math.round((s10 * h02 + s11 * h12 + s12 * h22) * SCALE);
  m[6] = Math.round((s20 * h00 + s21 * h10 + s22 * h20) * SCALE);
  m[7] = Math.round((s20 * h01 + s21 * h11 + s22 * h21) * SCALE);
  m[8] = Math.round((s20 * h02 + s21 * h12 + s22 * h22) * SCALE);
  return m;
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
