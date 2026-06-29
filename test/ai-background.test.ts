import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const dispose = vi.fn(() => Promise.resolve());
  const segmenter = Object.assign(
    vi.fn(() =>
      Promise.resolve({
        width: 2,
        height: 1,
        channels: 4,
        data: Uint8Array.from([10, 20, 30, 64, 40, 50, 60, 224]),
      }),
    ),
    { dispose },
  );
  const pipeline = vi.fn(
    (
      _task: string,
      _model: string,
      options: { progress_callback: (info: unknown) => void },
    ) => {
      options.progress_callback({ status: "ready" });
      return Promise.resolve(segmenter);
    },
  );
  return { dispose, pipeline, segmenter };
});

vi.mock("@huggingface/transformers", () => ({
  env: {
    allowRemoteModels: true,
    allowLocalModels: false,
    useBrowserCache: false,
  },
  pipeline: mocks.pipeline,
}));

import {
  default as ai,
  createAiBackgroundRemover,
  removeBackgroundAi,
} from "../src/ai/index.js";

describe("AI background remover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shares one model initialization across parallel preload calls", async () => {
    const remover = createAiBackgroundRemover({ backend: "wasm" });
    const progress = vi.fn();

    const [first, second] = await Promise.all([
      remover.preload(progress),
      remover.preload(progress),
    ]);

    expect(first).toEqual(second);
    expect(first.backend).toBe("wasm");
    expect(mocks.pipeline).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith({
      label: "AI model ready",
      percent: 100,
    });
    await remover.dispose();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("reuses a preloaded pipeline for mask inference", async () => {
    const remover = createAiBackgroundRemover({ backend: "wasm" });
    await remover.preload();

    const result = await remover.createMask("image.png");

    expect(mocks.pipeline).toHaveBeenCalledTimes(1);
    expect(mocks.segmenter).toHaveBeenCalledTimes(1);
    expect(Array.from(result.mask.data)).toEqual([64, 224]);
    await remover.dispose();
  });

  it("removes a background from a canvas in one call", async () => {
    const canvas = new MockCanvas(
      2,
      1,
      Uint8ClampedArray.from([10, 20, 30, 255, 40, 50, 60, 255]),
    );

    const result = await removeBackgroundAi(
      canvas as unknown as OffscreenCanvas,
      {
        backend: "wasm",
        threshold: 128,
        softness: 127,
        featherRadius: 0,
      },
    );

    expect(result.backend).toBe("wasm");
    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    expect(Array.from(result.alphaMask.data)).toEqual([64, 224]);
    expect(result.data[3]).toBe(0);
    expect(result.data[7]).toBeGreaterThan(0);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("exposes a default AI facade", async () => {
    const canvas = new MockCanvas(
      2,
      1,
      new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]),
    );

    const result = await ai.removeBackground(
      canvas as unknown as OffscreenCanvas,
      {
        backend: "wasm",
        threshold: 128,
        softness: 127,
        featherRadius: 0,
      },
    );

    expect(result.backend).toBe("wasm");
    expect(Array.from(result.alphaMask.data)).toEqual([64, 224]);
  });
});

class MockCanvas {
  public constructor(
    public readonly width: number,
    public readonly height: number,
    private readonly data: Uint8ClampedArray<ArrayBuffer>,
  ) {}

  public getContext(): {
    readonly getImageData: () => ImageData;
    readonly drawImage: () => void;
  } {
    return {
      getImageData: () => {
        return {
          width: this.width,
          height: this.height,
          data: this.data,
          colorSpace: "srgb",
        };
      },
      drawImage: () => undefined,
    };
  }
}

vi.stubGlobal("OffscreenCanvas", MockCanvas);
