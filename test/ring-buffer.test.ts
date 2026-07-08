import { describe, expect, it } from "vitest";
import {
  FixedByteRingBuffer,
  pipeChunksToBuffer,
} from "../src/index.js";

describe("FixedByteRingBuffer", () => {
  it("writes and reads bytes without growing", () => {
    const ring = new FixedByteRingBuffer(4);

    expect(ring.write(Uint8Array.from([1, 2, 3]))).toBe(3);
    expect(ring.availableRead).toBe(3);
    expect(ring.availableWrite).toBe(1);

    const out = new Uint8Array(2);
    expect(ring.read(out)).toBe(2);
    expect(Array.from(out)).toEqual([1, 2]);
  });

  it("wraps around while preserving order", () => {
    const ring = new FixedByteRingBuffer(4);
    ring.writeOrThrow(Uint8Array.from([1, 2, 3]));

    const first = new Uint8Array(2);
    ring.read(first);
    ring.writeOrThrow(Uint8Array.from([4, 5, 6]));

    const second = new Uint8Array(4);
    expect(ring.read(second)).toBe(4);
    expect(Array.from(second)).toEqual([3, 4, 5, 6]);
  });

  it("throws when writeOrThrow exceeds capacity", () => {
    const ring = new FixedByteRingBuffer(2);
    expect(() => ring.writeOrThrow(Uint8Array.from([1, 2, 3]))).toThrow(
      /overflow/i,
    );
  });
});

describe("pipeChunksToBuffer", () => {
  it("processes chunks through bounded capacity", async () => {
    const seen: number[] = [];
    const total = await pipeChunksToBuffer(
      [Uint8Array.from([1, 2]), Uint8Array.from([3])],
      (chunk) => {
        seen.push(...chunk);
      },
      2,
    );

    expect(total).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });
});
