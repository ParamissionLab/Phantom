import { PhantomError, type PixelFilter } from "./types.js";

export interface PixelFilterProfile {
  readonly id: PixelFilter;
  readonly label: string;
  readonly description: string;
  readonly overlap: number;
  readonly category: "utility" | "creative" | "enhancement";
  readonly wasm: boolean;
  readonly webgpu: boolean;
}

export const PIXEL_FILTER_PROFILES: readonly PixelFilterProfile[] = [
  {
    id: "identity",
    label: "Identity",
    description: "Copies pixels without modification.",
    overlap: 0,
    category: "utility",
    wasm: true,
    webgpu: false,
  },
  {
    id: "smoothEnhance",
    label: "Natural Enhance",
    description: "Soft local-contrast enhancement that avoids harsh clipping.",
    overlap: 1,
    category: "enhancement",
    wasm: true,
    webgpu: true,
  },
  {
    id: "sharpen3x3",
    label: "Crisp Sharpen",
    description: "Aggressive 3x3 sharpening for high-frequency detail.",
    overlap: 1,
    category: "enhancement",
    wasm: true,
    webgpu: true,
  },
  {
    id: "boxBlur3x3",
    label: "Soft Blur",
    description: "Fast 3x3 blur for previews, placeholders, and masks.",
    overlap: 1,
    category: "enhancement",
    wasm: true,
    webgpu: true,
  },
  {
    id: "unsharpMask",
    label: "Phantom Clarity",
    description: "High-clarity unsharp mask tuned for compressed delivery.",
    overlap: 1,
    category: "enhancement",
    wasm: true,
    webgpu: true,
  },
  {
    id: "grayscale",
    label: "Grayscale",
    description: "Fixed-point luminance conversion.",
    overlap: 0,
    category: "creative",
    wasm: true,
    webgpu: true,
  },
  {
    id: "invert",
    label: "Invert",
    description: "Packed RGB inversion while preserving alpha.",
    overlap: 0,
    category: "creative",
    wasm: true,
    webgpu: true,
  },
] as const;

/**
 * Lists all public pixel filters supported by the SDK.
 */
export function listPixelFilters(): readonly PixelFilterProfile[] {
  return PIXEL_FILTER_PROFILES;
}

/**
 * Returns metadata for a pixel filter.
 */
export function getPixelFilterProfile(filter: PixelFilter): PixelFilterProfile {
  const profile = PIXEL_FILTER_PROFILES.find((entry) => entry.id === filter);
  if (profile === undefined) {
    throw new PhantomError(`Unsupported pixel filter: ${String(filter)}.`);
  }
  return profile;
}

/**
 * Returns the overlap radius needed for tile-safe processing.
 */
export function getPixelFilterOverlap(filter: PixelFilter): number {
  return getPixelFilterProfile(filter).overlap;
}
