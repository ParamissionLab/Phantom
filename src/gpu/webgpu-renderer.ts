import {
  PhantomError,
  RGBA_CHANNELS,
  type ImageDimensions,
} from "../core/types.js";

interface GpuNavigatorLike {
  readonly gpu?: {
    requestAdapter(): Promise<GpuAdapter | null>;
    getPreferredCanvasFormat(): string;
  };
}

interface GpuAdapter {
  requestDevice(): Promise<GpuDevice>;
}

interface GpuDevice {
  readonly queue: {
    writeTexture(
      destination: unknown,
      data: Uint8Array,
      layout: unknown,
      size: unknown,
    ): void;
  };
  createTexture(descriptor: unknown): GpuTexture;
}

interface GpuTexture {
  createView(): unknown;
}

/**
 * Minimal WebGPU texture upload renderer. It validates dimensions and keeps
 * GPU setup isolated from the CPU processing pipeline.
 */
export class WebGpuRgbaRenderer {
  private device: GpuDevice | undefined;
  private texture: GpuTexture | undefined;
  private dimensions: ImageDimensions | undefined;

  public static async create(
    canvas: HTMLCanvasElement,
    dimensions: ImageDimensions,
  ): Promise<WebGpuRgbaRenderer> {
    const gpu = (navigator as unknown as GpuNavigatorLike).gpu;
    if (gpu === undefined) {
      throw new PhantomError("WebGPU is not available in this browser.");
    }

    const adapter = await gpu.requestAdapter();
    if (adapter === null) {
      throw new PhantomError("WebGPU adapter request failed.");
    }

    const renderer = new WebGpuRgbaRenderer();
    renderer.device = await adapter.requestDevice();
    renderer.dimensions = dimensions;
    renderer.texture = renderer.device.createTexture({
      size: [dimensions.width, dimensions.height],
      format: "rgba8unorm",
      usage: 1 | 2 | 4,
    });

    const context = canvas.getContext("webgpu") as unknown as {
      configure(descriptor: unknown): void;
    } | null;
    if (context === null) {
      throw new PhantomError("Unable to create WebGPU canvas context.");
    }
    context.configure({
      device: renderer.device,
      format: gpu.getPreferredCanvasFormat(),
      alphaMode: "premultiplied",
    });

    return renderer;
  }

  public upload(rgba: Uint8Array): void {
    if (
      this.device === undefined ||
      this.texture === undefined ||
      this.dimensions === undefined
    ) {
      throw new PhantomError("WebGPU renderer has not been initialized.");
    }

    const expected =
      this.dimensions.width * this.dimensions.height * RGBA_CHANNELS;
    if (rgba.length !== expected) {
      throw new PhantomError(
        `RGBA buffer length mismatch: expected ${expected}, got ${rgba.length}.`,
      );
    }

    this.device.queue.writeTexture(
      { texture: this.texture },
      rgba,
      {
        bytesPerRow: this.dimensions.width * RGBA_CHANNELS,
        rowsPerImage: this.dimensions.height,
      },
      [this.dimensions.width, this.dimensions.height],
    );
  }
}
