import { describe, expect, it } from "vitest";
import { SharedTileBuffer } from "../src/workers/index.js";

describe("SharedTileBuffer", () => {
  it("allocates bounded byte views", () => {
    const buffer = new SharedTileBuffer(8, { preferShared: false });
    const view = buffer.view(2, 4);

    view.set([1, 2, 3, 4]);

    expect(buffer.shared).toBe(false);
    expect(Array.from(buffer.bytes)).toEqual([0, 0, 1, 2, 3, 4, 0, 0]);
  });

  it("rejects out-of-bounds views", () => {
    const buffer = new SharedTileBuffer(4, { preferShared: false });
    expect(() => buffer.view(3, 2)).toThrow(/outside buffer bounds/i);
  });
});
