import { describe, expect, it } from "vitest";
import {
  applyAlphaMask,
  estimateBackgroundColor,
  estimateBackgroundPalette,
  refineAlphaMask,
  removeBackground,
  replaceTransparentBackground,
} from "../src/index.js";

const whiteBorderRedCenter = Uint8Array.from([
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 220, 20, 20, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255,
]);

describe("background removal", () => {
  it("estimates a plain background from edge pixels", () => {
    const background = estimateBackgroundColor(
      {
        width: 3,
        height: 3,
        data: whiteBorderRedCenter,
      },
      1,
    );

    expect(background).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("converts matching background pixels to transparent alpha", () => {
    const result = removeBackground(
      {
        width: 3,
        height: 3,
        data: whiteBorderRedCenter,
      },
      {
        threshold: 8,
        softness: 0,
        edgeSampleSize: 1,
        featherRadius: 0,
      },
    );

    expect(result.removedPixels).toBe(8);
    expect(result.data[3]).toBe(0);
    expect(result.data[19]).toBe(255);
    expect(result.diagnostics.mode).toBe("fuzzy");
    expect(result.diagnostics.edgeConnectedPixels).toBe(8);
  });

  it("keeps isolated foreground highlights that match the background color", () => {
    const white = [255, 255, 255, 255];
    const red = [220, 20, 20, 255];
    const rgba = Uint8Array.from([
      ...white,
      ...white,
      ...white,
      ...white,
      ...white,
      ...white,
      ...red,
      ...red,
      ...red,
      ...white,
      ...white,
      ...red,
      ...white,
      ...red,
      ...white,
      ...white,
      ...red,
      ...red,
      ...red,
      ...white,
      ...white,
      ...white,
      ...white,
      ...white,
      ...white,
    ]);

    const result = removeBackground(
      {
        width: 5,
        height: 5,
        data: rgba,
      },
      {
        threshold: 10,
        softness: 0,
        edgeSampleSize: 1,
        featherRadius: 0,
      },
    );

    const centerAlpha = result.data[(2 * 5 + 2) * 4 + 3];
    expect(centerAlpha).toBe(255);
    expect(result.data[3]).toBe(0);
  });

  it("learns a multi-color edge palette for fuzzy masks", () => {
    const palette = estimateBackgroundPalette(
      {
        width: 4,
        height: 2,
        data: Uint8Array.from([
          245, 245, 245, 255, 245, 245, 245, 255, 30, 40, 52, 255, 30, 40, 52,
          255, 245, 245, 245, 255, 245, 245, 245, 255, 30, 40, 52, 255, 30, 40,
          52, 255,
        ]),
      },
      1,
      2,
    );

    expect(palette).toHaveLength(2);
    expect(palette).toContainEqual({ r: 245, g: 245, b: 245 });
    expect(palette).toContainEqual({ r: 30, g: 40, b: 52 });
  });

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
