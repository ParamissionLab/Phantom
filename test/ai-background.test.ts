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

import { createAiBackgroundRemover } from "../src/ai/index.js";

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
});
