import { describe, expect, it } from "vitest";
import {
  PhantomError,
  createZigTileProcessor,
  type WasmKernelBackend,
} from "../src/index.js";

describe("createZigTileProcessor", () => {
  it("adapts tile descriptors to Zig WASM tile offsets", async () => {
    const calls: unknown[] = [];
    const backend = createFakeBackend((...args) => {
      calls.push(args);
      return Uint8Array.from([1, 2, 3, 4]);
    });
    const processor = createZigTileProcessor(backend);

    const result = await processor.processTile(
      {
        descriptor: {
          index: 7,
          input: { x: 10, y: 20, width: 3, height: 3 },
          output: { x: 11, y: 21, width: 1, height: 1 },
        },
        rgba: new Uint8Array(3 * 3 * 4),
      },
      "smoothEnhance",
    );

    expect(result.rgba).toEqual(Uint8Array.from([1, 2, 3, 4]));
    expect(calls).toEqual([
      [new Uint8Array(3 * 3 * 4), 3, 3, 1, 1, 1, 1, "smoothEnhance"],
    ]);
  });

  it("rejects tile descriptors where output is outside input", () => {
    const processor = createZigTileProcessor(
      createFakeBackend(() => new Uint8Array(4)),
    );

    expect(() =>
      processor.processTile(
        {
          descriptor: {
            index: 0,
            input: { x: 4, y: 4, width: 2, height: 2 },
            output: { x: 3, y: 4, width: 1, height: 1 },
          },
          rgba: new Uint8Array(16),
        },
        "identity",
      ),
    ).toThrow(PhantomError);
  });
});

function createFakeBackend(
  processTile: WasmKernelBackend["processTile"],
): WasmKernelBackend {
  return {
    memory: new WebAssembly.Memory({ initial: 1 }),
    process() {
      throw new Error("process is not used by these tests.");
    },
    applyAlphaMask() {
      throw new Error("applyAlphaMask is not used by these tests.");
    },
    processTile,
  };
}
