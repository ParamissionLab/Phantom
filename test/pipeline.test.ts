import { describe, expect, it, vi } from "vitest";
import {
  PhantomError,
  processRawImage,
  processRawImagePipeline,
  processRawImageWithStats,
  processTileSource,
  type RawRgbaImage,
  type TileSink,
  type TileProcessor,
  type TileSource,
} from "../src/index.js";

function makeImage(): RawRgbaImage {
  return {
    width: 3,
    height: 2,
    data: Uint8Array.from([
      1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255, 13, 14, 15,
      255, 16, 17, 18, 255,
    ]),
  };
}

describe("processRawImage", () => {
  it("processes every tile and preserves image dimensions", async () => {
    const seen: number[] = [];
    const output = await processRawImage(makeImage(), {
      tileSize: 2,
      overlap: 1,
      filter: "invert",
      onTile: (tile) => {
        seen.push(tile.index);
      },
    });

    expect(output.width).toBe(3);
    expect(output.height).toBe(2);
    expect(seen).toEqual([0, 1]);
    expect(Array.from(output.data.subarray(0, 8))).toEqual([
      254, 253, 252, 255, 251, 250, 249, 255,
    ]);
  });

  it("rejects malformed RGBA input", async () => {
    await expect(
      processRawImage({
        width: 2,
        height: 2,
        data: Uint8Array.from([1, 2, 3]),
      }),
    ).rejects.toThrow(/length mismatch/i);
  });

  it("reports progress and runtime stats", async () => {
    const progress: Array<{
      readonly completedTiles: number;
      readonly totalTiles: number;
      readonly percent: number;
    }> = [];

    const result = await processRawImageWithStats(makeImage(), {
      tileSize: 2,
      overlap: 1,
      filter: "identity",
      onProgress: (event) => {
        progress.push({
          completedTiles: event.completedTiles,
          totalTiles: event.totalTiles,
          percent: event.percent,
        });
      },
    });

    expect(result.image.data).toEqual(makeImage().data);
    expect(result.stats.totalTiles).toBe(2);
    expect(result.stats.processedTiles).toBe(2);
    expect(result.stats.outputBytes).toBe(makeImage().data.length);
    expect(result.stats.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(progress).toEqual([
      { completedTiles: 1, totalTiles: 2, percent: 50 },
      { completedTiles: 2, totalTiles: 2, percent: 100 },
    ]);
  });

  it("can delegate tile work to a custom processor", async () => {
    const seenFilters: string[] = [];
    const tileProcessor: TileProcessor = {
      id: "test-processor",
      processTile(payload, filter) {
        seenFilters.push(filter);
        const output = new Uint8Array(
          payload.descriptor.output.width *
            payload.descriptor.output.height *
            4,
        );
        output.fill(7);
        return { descriptor: payload.descriptor, rgba: output };
      },
    };

    const output = await processRawImage(makeImage(), {
      tileSize: 3,
      overlap: 0,
      filter: "identity",
      tileProcessor,
    });

    expect(seenFilters).toEqual(["identity"]);
    expect(Array.from(output.data)).toEqual(new Array<number>(24).fill(7));
  });

  it('honors a custom processor even when it uses the "cpu" id', async () => {
    const tileProcessor: TileProcessor = {
      id: "cpu",
      processTile(payload) {
        return {
          descriptor: payload.descriptor,
          rgba: new Uint8Array(
            payload.descriptor.output.width *
              payload.descriptor.output.height *
              4,
          ).fill(7),
        };
      },
    };

    const output = await processRawImage(makeImage(), {
      tileSize: 3,
      overlap: 0,
      filter: "identity",
      tileProcessor,
    });

    expect(Array.from(output.data)).toEqual(new Array<number>(24).fill(7));
  });

  it("rejects custom processor output with the wrong tile length", async () => {
    const tileProcessor: TileProcessor = {
      id: "broken-processor",
      processTile(payload) {
        return { descriptor: payload.descriptor, rgba: new Uint8Array(1) };
      },
    };

    await expect(
      processRawImage(makeImage(), {
        tileSize: 3,
        overlap: 0,
        filter: "identity",
        tileProcessor,
      }),
    ).rejects.toThrow(/broken-processor.*expected/i);
  });

  it("rejects malformed tile source buffers before custom processors run", async () => {
    const processTile = vi.fn<TileProcessor["processTile"]>();
    const tileProcessor: TileProcessor = {
      id: "unused-processor",
      processTile,
    };
    const source: TileSource = {
      read() {
        return new Uint8Array(1);
      },
    };
    const sink: TileSink = {
      write() {
        throw new Error("sink should not be called");
      },
    };

    await expect(
      processTileSource({ width: 2, height: 2 }, source, sink, {
        tileSize: 2,
        overlap: 0,
        filter: "identity",
        tileProcessor,
      }),
    ).rejects.toThrow(/tile source.*expected/i);
    expect(processTile).not.toHaveBeenCalled();
  });

  it("runs multiple filters as a reusable pipeline", async () => {
    const output = await processRawImagePipeline(
      {
        width: 1,
        height: 1,
        data: Uint8Array.from([10, 20, 30, 255]),
      },
      [
        { filter: "grayscale", overlap: 0 },
        { filter: "invert", overlap: 0 },
      ],
      { tileSize: 1 },
    );

    expect(Array.from(output.data)).toEqual([237, 237, 237, 255]);
  });

  it("preserves processor and progress options across every pipeline stage", async () => {
    const seenFilters: string[] = [];
    const progress: number[] = [];
    const tileProcessor: TileProcessor = {
      id: "pipeline-processor",
      processTile(payload, filter) {
        seenFilters.push(filter);
        return {
          descriptor: payload.descriptor,
          rgba: new Uint8Array(
            payload.descriptor.output.width *
              payload.descriptor.output.height *
              4,
          ).fill(seenFilters.length),
        };
      },
    };

    const output = await processRawImagePipeline(
      makeImage(),
      [
        { filter: "invert", overlap: 0 },
        { filter: "grayscale", overlap: 0 },
      ],
      {
        tileSize: 3,
        tileProcessor,
        onProgress: ({ percent }) => progress.push(percent),
      },
    );

    expect(seenFilters).toEqual(["invert", "grayscale"]);
    expect(progress).toEqual([100, 100]);
    expect(Array.from(output.data)).toEqual(new Array<number>(24).fill(2));
  });

  it("rejects malformed pipeline input before processing", async () => {
    await expect(
      processRawImagePipeline(
        { width: 1, height: 1, data: Uint8Array.of(1, 2, 3) },
        [
          { filter: "invert", overlap: 0 },
          { filter: "grayscale", overlap: 0 },
        ],
      ),
    ).rejects.toThrow(/length mismatch/i);
  });

  it("stops an aborted pipeline before its first stage", async () => {
    const controller = new AbortController();
    const processTile = vi.fn<TileProcessor["processTile"]>();
    controller.abort();

    await expect(
      processRawImagePipeline(
        makeImage(),
        [
          { filter: "invert", overlap: 0 },
          { filter: "grayscale", overlap: 0 },
        ],
        {
          tileSize: 3,
          signal: controller.signal,
          tileProcessor: { id: "aborted", processTile },
        },
      ),
    ).rejects.toThrow(/abort/i);
    expect(processTile).not.toHaveBeenCalled();
  });

  it("rejects filters when the requested overlap is too small", async () => {
    await expect(
      processRawImage(makeImage(), {
        tileSize: 2,
        overlap: 0,
        filter: "sharpen3x3",
      }),
    ).rejects.toThrow(/requires overlap/i);
  });

  it("rejects unsupported filters with a branded error", async () => {
    await expect(
      processRawImage(makeImage(), {
        filter: "missing" as never,
      }),
    ).rejects.toBeInstanceOf(PhantomError);
  });
});
