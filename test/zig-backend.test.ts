import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  applyFilter,
  applyFilterToTile,
  applyFilters,
  editImage,
  instantiateZigBackend,
  listPixelFilters,
  processRawImage,
  type RawRgbaImage,
  type TileDescriptor,
} from "../src/index.js";

const wasmUrl = new URL("../dist/phantom_kernel.wasm", import.meta.url);

async function loadBackend() {
  return instantiateZigBackend(await readFile(wasmUrl));
}

function makeImage(): RawRgbaImage {
  const width = 5;
  const height = 4;
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    data[index] = (pixel * 37 + 11) % 256;
    data[index + 1] = (pixel * 73 + 29) % 256;
    data[index + 2] = (pixel * 19 + 101) % 256;
    data[index + 3] = 50 + ((pixel * 41) % 206);
  }
  return { width, height, data };
}

describe("Zig 0.16 WASM backend", () => {
  it("exposes backend capabilities and Zig scratch estimates", async () => {
    const backend = await loadBackend();

    expect(backend.id).toBe("zig-wasm");
    expect(backend.supportsFilter("unsharpMask")).toBe(true);
    expect(backend.estimateTileBytes(64, 64, 1)).toBe(33_808n);
  });

  it("matches the TypeScript tile reference for every public filter", async () => {
    const backend = await loadBackend();
    const image = makeImage();

    for (const { id: filter, overlap } of listPixelFilters()) {
      const expected = await processRawImage(image, {
        tileSize: 2,
        overlap,
        filter,
      });
      const actual = await processRawImage(image, {
        tileSize: 2,
        overlap,
        filter,
        backend,
      });
      expect(actual.data, filter).toEqual(expected.data);
    }
  });

  it("drives the high-level filter, multi-filter, and edit APIs", async () => {
    const backend = await loadBackend();
    const image = makeImage();
    const expected = await applyFilters(image, ["grayscale", "invert"], {
      tileSize: 2,
    });

    const filtered = await applyFilter(image, "grayscale", {
      tileSize: 2,
      backend,
    });
    const piped = await applyFilters(image, ["grayscale", "invert"], {
      tileSize: 2,
      backend,
    });
    const edited = await editImage(image)
      .filter("grayscale", { tileSize: 2, backend })
      .filter("invert", { tileSize: 2, backend })
      .run();

    expect(filtered.data).toEqual(
      (await applyFilter(image, "grayscale", { tileSize: 2 })).data,
    );
    expect(piped.data).toEqual(expected.data);
    expect(edited.data).toEqual(expected.data);
  });

  it("applies alpha masks with the native Zig kernel", async () => {
    const backend = await loadBackend();
    const image = makeImage();
    const mask = Uint8Array.from({ length: 20 }, (_, index) => index * 13);
    const output = backend.applyAlphaMask(image, mask);
    const sourceAlpha = image.data[7] ?? 0;

    expect(output.data[3]).toBe(0);
    expect(output.data[7]).toBe(Math.floor((sourceAlpha * 13 + 127) / 255));
    expect(output.data[0]).toBe(image.data[0]);
  });

  it("rejects tile windows outside the supplied input", async () => {
    const backend = await loadBackend();
    expect(() =>
      backend.processTile(new Uint8Array(16), 2, 2, 1, 0, 2, 1, "identity"),
    ).toThrow(/outside the input tile/i);
  });

  it("rejects values that cannot cross the WASM u32 boundary safely", async () => {
    const backend = await loadBackend();
    expect(() =>
      backend.processTile(
        new Uint8Array(4),
        1,
        1,
        0x1_0000_0000,
        0,
        1,
        1,
        "identity",
      ),
    ).toThrow(/WebAssembly u32/i);
  });

  it("keeps direct tile calls compatible with the reference contract", async () => {
    const backend = await loadBackend();
    const descriptor: TileDescriptor = {
      index: 0,
      input: { x: 8, y: 4, width: 3, height: 3 },
      output: { x: 9, y: 5, width: 1, height: 1 },
    };
    const input = makeImage().data.slice(0, 3 * 3 * 4);
    const expected = applyFilterToTile(
      { descriptor, rgba: input },
      "boxBlur3x3",
    );
    const actual = backend.processTile(input, 3, 3, 1, 1, 1, 1, "boxBlur3x3");

    expect(actual).toEqual(expected.rgba);
  });
});
