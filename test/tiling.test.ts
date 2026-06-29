import { describe, expect, it } from "vitest";
import { planTiles } from "../src/index.js";

describe("planTiles", () => {
  it("creates overlap-expanded input rectangles", () => {
    const tiles = planTiles({ width: 5, height: 5, tileSize: 3, overlap: 1 });

    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toEqual({
      index: 0,
      input: { x: 0, y: 0, width: 4, height: 4 },
      output: { x: 0, y: 0, width: 3, height: 3 },
    });
    expect(tiles[3]).toEqual({
      index: 3,
      input: { x: 2, y: 2, width: 3, height: 3 },
      output: { x: 3, y: 3, width: 2, height: 2 },
    });
  });

  it("rejects invalid overlap", () => {
    expect(() =>
      planTiles({ width: 8, height: 8, tileSize: 4, overlap: 4 }),
    ).toThrow(/overlap/i);
  });
});
