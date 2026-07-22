import { describe, expect, it } from "vitest";
import phantomDefault, {
  applyFilter,
  applyFilters,
  applyMask,
  createAssetPlan,
  createImage,
  cropImage,
  editImage,
  phantom,
  replaceBackground,
  resizeImage,
  type RawRgbaImage,
  type TileProcessor,
} from "../src/index.js";

function sampleImage(): RawRgbaImage {
  return {
    width: 2,
    height: 2,
    data: Uint8Array.from([
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
    ]),
  };
}

describe("default phantom API", () => {
  it("creates, crops, and resizes images with short helper names", () => {
    const base = createImage(2, 2, { r: 20, g: 30, b: 40 });
    const cropped = cropImage(base, { x: 1, y: 0, width: 1, height: 2 });
    const resized = resizeImage(cropped, 2, 2, { method: "nearest" });

    expect(base.data[3]).toBe(255);
    expect(cropped.width).toBe(1);
    expect(cropped.height).toBe(2);
    expect(resized.width).toBe(2);
    expect(resized.height).toBe(2);
  });

  it("exposes a single default facade", async () => {
    const image = phantom.createImage(1, 1, { r: 10, g: 20, b: 30 });
    const output = await phantom.applyFilter(image, "invert");

    expect(Array.from(output.data)).toEqual([245, 235, 225, 255]);
  });

  it("supports default import for the main API", async () => {
    const image = phantomDefault.createImage(1, 1, { r: 10, g: 20, b: 30 });
    const output = await phantomDefault.applyFilter(image, "invert");

    expect(Array.from(output.data)).toEqual([245, 235, 225, 255]);
  });

  it("supports a beginner-friendly edit pipeline from the default facade", async () => {
    const output = await phantom
      .edit(sampleImage())
      .crop({ x: 0, y: 0, width: 1, height: 1 })
      .resize(2, 1, { method: "nearest" })
      .filter("invert", { tileSize: 1 })
      .background({ r: 255, g: 255, b: 255 })
      .run();

    expect(output.width).toBe(2);
    expect(output.height).toBe(1);
    expect(Array.from(output.data)).toEqual([
      245, 235, 225, 255, 245, 235, 225, 255,
    ]);
  });

  it("supports named editImage", async () => {
    const edited = await editImage(sampleImage())
      .filters(["grayscale", "invert"], { tileSize: 1 })
      .run();
    const plan = await editImage(sampleImage()).plan();

    expect(edited.width).toBe(2);
    expect(plan.filters).toContain("smoothEnhance");
  });

  it("applies a filter without requiring overlap knowledge", async () => {
    const output = await applyFilter(sampleImage(), "sharpen3x3");

    expect(output.width).toBe(2);
    expect(output.height).toBe(2);
    expect(output.data).toHaveLength(sampleImage().data.length);
  });

  it("applies multiple filters with safe defaults", async () => {
    const seenTiles: number[] = [];
    const output = await applyFilters(
      {
        width: 1,
        height: 1,
        data: Uint8Array.from([10, 20, 30, 255]),
      },
      ["grayscale", "invert"],
      {
        tileSize: 1,
        onTile: (tile) => seenTiles.push(tile.index),
      },
    );

    expect(Array.from(output.data)).toEqual([237, 237, 237, 255]);
    expect(seenTiles).toEqual([0, 0]);
  });

  it("passes custom tile processors through the simple filter helpers", async () => {
    const seenFilters: string[] = [];
    const tileProcessor: TileProcessor = {
      id: "facade-test",
      processTile(payload, filter) {
        seenFilters.push(filter);
        const output = new Uint8Array(
          payload.descriptor.output.width *
            payload.descriptor.output.height *
            4,
        );
        output.fill(42);
        return { descriptor: payload.descriptor, rgba: output };
      },
    };

    const output = await applyFilter(sampleImage(), "identity", {
      tileSize: 2,
      tileProcessor,
    });

    expect(seenFilters).toEqual(["identity"]);
    expect(Array.from(output.data)).toEqual(new Array<number>(16).fill(42));
  });

  it("uses simple aliases for masks, backgrounds, and asset planning", () => {
    const cutout = applyMask(
      {
        width: 1,
        height: 1,
        data: Uint8Array.from([255, 255, 255, 255]),
      },
      {
        width: 1,
        height: 1,
        data: Uint8Array.of(0),
      },
      { threshold: 1, softness: 0, featherRadius: 0 },
    );
    const masked = applyMask(sampleImage(), {
      width: 1,
      height: 1,
      data: Uint8Array.of(128),
    });
    const flattened = replaceBackground(cutout, { r: 0, g: 0, b: 0 });
    const plan = createAssetPlan(sampleImage());

    expect(cutout.removedPixels).toBe(1);
    expect(masked.data[3]).toBeGreaterThan(0);
    expect(flattened.data[3]).toBe(255);
    expect(plan.encode.format).toBe("jpeg");
    expect(phantom.createAssetPlan(sampleImage()).filters).toContain(
      "smoothEnhance",
    );
  });
});
