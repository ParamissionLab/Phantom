import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeImageForExport,
  convertImageFormat,
  imageFormatExtension,
  smartExportImage,
} from "../src/browser/index.js";

describe("browser image export", () => {
  beforeEach(() => {
    MockCanvas.supportsWebp = true;
  });

  it("detects transparency and partial alpha from sampled pixels", () => {
    const analysis = analyzeImageForExport({
      width: 2,
      height: 1,
      data: Uint8Array.from([20, 30, 40, 0, 40, 50, 60, 128]),
    });

    expect(analysis.transparencyRatio).toBe(1);
    expect(analysis.partialAlphaRatio).toBe(0.5);
    expect(analysis.sampledPixels).toBe(2);
  });

  it("uses PNG for adaptive exports containing transparency", async () => {
    const result = await smartExportImage({
      width: 2,
      height: 1,
      data: Uint8Array.from([20, 30, 40, 0, 40, 50, 60, 255]),
    });

    expect(result.format).toBe("image/png");
    expect(result.reason).toMatch(/transparent/i);
    expect(result.fallbackUsed).toBe(false);
  });

  it("uses WebP for an opaque color-rich image", async () => {
    const data = new Uint8Array(256 * 4);
    for (let pixel = 0; pixel < 256; pixel += 1) {
      const index = pixel * 4;
      data[index] = pixel;
      data[index + 1] = (pixel * 7) % 256;
      data[index + 2] = (pixel * 13) % 256;
      data[index + 3] = 255;
    }

    const result = await smartExportImage({ width: 256, height: 1, data });

    expect(result.requestedFormat).toBe("image/webp");
    expect(result.format).toBe("image/webp");
  });

  it("converts explicitly to JPEG and validates quality", async () => {
    const image = {
      width: 1,
      height: 1,
      data: Uint8Array.from([20, 30, 40, 128]),
    };
    const result = await convertImageFormat(image, {
      format: "image/jpeg",
      quality: 0.9,
      matte: { r: 10, g: 20, b: 30 },
    });

    expect(result.format).toBe("image/jpeg");
    expect(result.bytes).toBeGreaterThan(0);
    await expect(
      convertImageFormat(image, { format: "image/webp", quality: 2 }),
    ).rejects.toThrow(/between 0 and 1/i);
  });

  it("falls back to PNG when the requested browser encoder is unavailable", async () => {
    MockCanvas.supportsWebp = false;

    const result = await convertImageFormat(
      {
        width: 1,
        height: 1,
        data: Uint8Array.from([20, 30, 40, 255]),
      },
      { format: "image/webp" },
    );

    expect(result.requestedFormat).toBe("image/webp");
    expect(result.format).toBe("image/png");
    expect(result.fallbackUsed).toBe(true);
  });

  it("returns conventional file extensions", () => {
    expect(imageFormatExtension("image/png")).toBe("png");
    expect(imageFormatExtension("image/jpeg")).toBe("jpg");
    expect(imageFormatExtension("image/webp")).toBe("webp");
  });
});

class MockImageData {
  public readonly width: number;
  public readonly height: number;

  public constructor(
    public readonly data: Uint8ClampedArray<ArrayBuffer>,
    width: number,
    height: number,
  ) {
    this.width = width;
    this.height = height;
  }
}

class MockCanvas {
  public static supportsWebp = true;
  private data: Uint8ClampedArray<ArrayBuffer>;

  public constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  public getContext(): {
    fillStyle: string;
    fillRect: () => void;
    drawImage: (source: MockCanvas) => void;
    putImageData: (image: MockImageData) => void;
    getImageData: () => MockImageData;
  } {
    return {
      fillStyle: "",
      fillRect: () => undefined,
      drawImage: (source) => {
        this.data.set(source.data);
      },
      putImageData: (image) => {
        this.data.set(image.data);
      },
      getImageData: () => new MockImageData(this.data, this.width, this.height),
    };
  }

  public convertToBlob(options: { readonly type?: string }): Promise<Blob> {
    const requested = options.type ?? "image/png";
    const type =
      requested === "image/webp" && !MockCanvas.supportsWebp
        ? "image/png"
        : requested;
    return Promise.resolve(new Blob([Uint8Array.of(1, 2, 3)], { type }));
  }
}

vi.stubGlobal("ImageData", MockImageData);
vi.stubGlobal("OffscreenCanvas", MockCanvas);
