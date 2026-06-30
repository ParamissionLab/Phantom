import { describe, expect, it } from "vitest";
import {
  applyAlphaMask,
  refineAlphaMask,
  replaceTransparentBackground,
} from "../src/index.js";

describe("AI mask utilities", () => {
  it("can flatten transparent pixels onto a solid background", () => {
    const flattened = replaceTransparentBackground(
      {
        width: 1,
        height: 2,
        data: Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 255]),
      },
      { r: 12, g: 20, b: 28 },
    );

    expect(Array.from(flattened.data)).toEqual([
      12, 20, 28, 255, 255, 0, 0, 255,
    ]);
  });

  it("resizes a semantic mask and preserves source transparency", () => {
    const result = applyAlphaMask(
      {
        width: 2,
        height: 2,
        data: Uint8Array.from([
          20, 30, 40, 255, 20, 30, 40, 128, 20, 30, 40, 255, 20, 30, 40, 255,
        ]),
      },
      {
        width: 1,
        height: 1,
        data: Uint8Array.of(128),
      },
      { threshold: 0, softness: 0, featherRadius: 0 },
    );

    expect(Array.from(result.mask)).toEqual([255, 255, 255, 255]);
    expect(result.data[3]).toBe(255);
    expect(result.data[7]).toBe(128);
  });

  it("keeps a color-guided mask edge sharper than a plain blur", () => {
    const image = {
      width: 3,
      height: 1,
      data: Uint8Array.from([
        240, 240, 240, 255, 20, 20, 20, 255, 20, 20, 20, 255,
      ]),
    };
    const mask = refineAlphaMask(
      image,
      { width: 3, height: 1, data: Uint8Array.from([0, 128, 255]) },
      { threshold: 0, softness: 255, featherRadius: 1, edgeSensitivity: 20 },
    );

    expect(mask[1]).toBeGreaterThan(128);
    expect(mask[0]).toBe(0);
    expect(mask[2]).toBe(255);
  });

  it("rejects malformed semantic masks", () => {
    expect(() =>
      refineAlphaMask(
        { width: 1, height: 1, data: Uint8Array.from([0, 0, 0, 255]) },
        { width: 2, height: 2, data: Uint8Array.of(255) },
      ),
    ).toThrow(/mask length mismatch/i);
  });
});
