import { describe, expect, it } from "vitest";
import {
  getPixelFilterOverlap,
  getPixelFilterProfile,
  listPixelFilters,
} from "../src/index.js";

describe("pixel filter profiles", () => {
  it("lists every public filter with tile metadata", () => {
    const filters = listPixelFilters();

    expect(filters.map((filter) => filter.id)).toEqual([
      "identity",
      "smoothEnhance",
      "sharpen3x3",
      "grayscale",
      "invert",
    ]);
    expect(filters.every((filter) => Number.isInteger(filter.overlap))).toBe(
      true,
    );
  });

  it("reports overlap radius for tile-safe filters", () => {
    expect(getPixelFilterOverlap("smoothEnhance")).toBe(1);
    expect(getPixelFilterOverlap("sharpen3x3")).toBe(1);
    expect(getPixelFilterOverlap("invert")).toBe(0);
  });

  it("describes backend support", () => {
    expect(getPixelFilterProfile("smoothEnhance")).toMatchObject({
      category: "enhancement",
      wasm: true,
      webgpu: true,
    });
  });
});
