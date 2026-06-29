export const FIXED_SHIFT = 8;
export const FIXED_ONE = 1 << FIXED_SHIFT;

export function toFixed(value: number): number {
  return Math.round(value * FIXED_ONE);
}

export function fromFixed(value: number): number {
  return value / FIXED_ONE;
}

export function multiplyFixed(a: number, b: number): number {
  return (a * b) >> FIXED_SHIFT;
}

export function clampU8(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 255) {
    return 255;
  }
  return value;
}

export function normalizeKernel3x3(
  kernel: readonly number[],
): readonly number[] {
  if (kernel.length !== 9) {
    throw new Error(
      `Expected a 3x3 kernel with 9 coefficients, got ${kernel.length}.`,
    );
  }
  return kernel.map(toFixed);
}
