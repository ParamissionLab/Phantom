import {
  PhantomError,
  type PixelFilter,
  type RawRgbaImage,
  assertRgbaLength,
} from "../core/types.js";

const GPU_BUFFER_USAGE_MAP_READ = 1;
const GPU_BUFFER_USAGE_COPY_SRC = 4;
const GPU_BUFFER_USAGE_COPY_DST = 8;
const GPU_BUFFER_USAGE_UNIFORM = 64;
const GPU_BUFFER_USAGE_STORAGE = 128;
const GPU_MAP_MODE_READ = 1;
const WORKGROUP_SIZE = 256;

type GpuWriteBufferSource = ArrayBufferLike | ArrayBufferView<ArrayBufferLike>;

interface GpuNavigatorLike {
  readonly gpu?: {
    requestAdapter(): Promise<GpuAdapterLike | null>;
  };
}

interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike>;
}

interface GpuDeviceLike {
  readonly queue: {
    writeBuffer(
      buffer: GpuBufferLike,
      offset: number,
      data: GpuWriteBufferSource,
    ): void;
    submit(commandBuffers: readonly unknown[]): void;
  };
  createBuffer(descriptor: unknown): GpuBufferLike;
  createShaderModule(descriptor: { readonly code: string }): unknown;
  createComputePipeline(descriptor: unknown): GpuComputePipelineLike;
  createBindGroup(descriptor: unknown): unknown;
  createCommandEncoder(): GpuCommandEncoderLike;
}

interface GpuBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}

interface GpuComputePipelineLike {
  getBindGroupLayout(index: number): unknown;
}

interface GpuCommandEncoderLike {
  beginComputePass(): GpuComputePassLike;
  copyBufferToBuffer(
    source: GpuBufferLike,
    sourceOffset: number,
    destination: GpuBufferLike,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): unknown;
}

interface GpuComputePassLike {
  setPipeline(pipeline: GpuComputePipelineLike): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  dispatchWorkgroups(workgroups: number): void;
  end(): void;
}

/**
 * WebGPU compute backend for full-frame or tile RGBA filters.
 */
export class WebGpuComputeBackend {
  private constructor(private readonly device: GpuDeviceLike) {}

  public static async create(): Promise<WebGpuComputeBackend> {
    const gpu = (navigator as unknown as GpuNavigatorLike).gpu;
    if (gpu === undefined) {
      throw new PhantomError("WebGPU is not available in this browser.");
    }

    const adapter = await gpu.requestAdapter();
    if (adapter === null) {
      throw new PhantomError("WebGPU adapter request failed.");
    }

    return new WebGpuComputeBackend(await adapter.requestDevice());
  }

  public async process(
    image: RawRgbaImage,
    filter: Exclude<PixelFilter, "identity">,
  ): Promise<RawRgbaImage> {
    assertRgbaLength(image);

    const input = this.device.createBuffer({
      size: image.data.byteLength,
      usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_DST,
    });
    const output = this.device.createBuffer({
      size: image.data.byteLength,
      usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_SRC,
    });
    const metadata = this.device.createBuffer({
      size: 16,
      usage: GPU_BUFFER_USAGE_UNIFORM | GPU_BUFFER_USAGE_COPY_DST,
    });
    const readback = this.device.createBuffer({
      size: image.data.byteLength,
      usage: GPU_BUFFER_USAGE_MAP_READ | GPU_BUFFER_USAGE_COPY_DST,
    });

    this.device.queue.writeBuffer(input, 0, image.data);
    this.device.queue.writeBuffer(
      metadata,
      0,
      new Uint32Array([
        image.width,
        image.height,
        image.width * image.height,
        0,
      ]),
    );

    const pipeline = this.device.createComputePipeline({
      layout: "auto",
      compute: {
        module: this.device.createShaderModule({ code: getShader(filter) }),
        entryPoint: "main",
      },
    });
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: input } },
        { binding: 1, resource: { buffer: output } },
        { binding: 2, resource: { buffer: metadata } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil((image.width * image.height) / WORKGROUP_SIZE),
    );
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, image.data.byteLength);
    this.device.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPU_MAP_MODE_READ);
    const result = new Uint8Array(readback.getMappedRange()).slice();
    readback.unmap();

    return {
      width: image.width,
      height: image.height,
      data: result,
    };
  }
}

function getShader(filter: Exclude<PixelFilter, "identity">): string {
  switch (filter) {
    case "invert":
      return shaderBody("invertPixel(pixel, index)");
    case "grayscale":
      return shaderBody("grayscalePixel(pixel, index)");
    case "smoothEnhance":
      return shaderBody("smoothEnhancePixel(index)");
    case "sharpen3x3":
      return shaderBody("sharpenPixel(index)");
    default:
      filter satisfies never;
      throw new PhantomError(`Unsupported WebGPU filter: ${String(filter)}`);
  }
}

function shaderBody(operation: string): string {
  return `
struct Metadata {
  width: u32,
  height: u32,
  pixels: u32,
  reserved: u32,
}

@group(0) @binding(0) var<storage, read> inputPixels: array<u32>;
@group(0) @binding(1) var<storage, read_write> outputPixels: array<u32>;
@group(0) @binding(2) var<uniform> metadata: Metadata;

fn red(pixel: u32) -> u32 { return pixel & 0xffu; }
fn green(pixel: u32) -> u32 { return (pixel >> 8u) & 0xffu; }
fn blue(pixel: u32) -> u32 { return (pixel >> 16u) & 0xffu; }
fn alpha(pixel: u32) -> u32 { return (pixel >> 24u) & 0xffu; }
fn pack(r: u32, g: u32, b: u32, a: u32) -> u32 {
  return (a << 24u) | (b << 16u) | (g << 8u) | r;
}
fn clampByte(value: i32) -> u32 {
  return u32(clamp(value, 0, 255));
}
fn sampleIndex(x: u32, y: u32) -> u32 {
  let cx = min(x, metadata.width - 1u);
  let cy = min(y, metadata.height - 1u);
  return cy * metadata.width + cx;
}
fn invertPixel(pixel: u32, index: u32) -> u32 {
  _ = index;
  return pack(255u - red(pixel), 255u - green(pixel), 255u - blue(pixel), alpha(pixel));
}
fn grayscalePixel(pixel: u32, index: u32) -> u32 {
  _ = index;
  let luma = (red(pixel) * 77u + green(pixel) * 150u + blue(pixel) * 29u) >> 8u;
  return pack(luma, luma, luma, alpha(pixel));
}
fn sharpenChannel(center: u32, left: u32, right: u32, top: u32, bottom: u32) -> u32 {
  return clampByte(i32(center) * 5 - i32(left) - i32(right) - i32(top) - i32(bottom));
}
fn sharpenPixel(index: u32) -> u32 {
  let x = index % metadata.width;
  let y = index / metadata.width;
  let leftX = select(x - 1u, 0u, x == 0u);
  let rightX = min(x + 1u, metadata.width - 1u);
  let topY = select(y - 1u, 0u, y == 0u);
  let bottomY = min(y + 1u, metadata.height - 1u);
  let c = inputPixels[index];
  let l = inputPixels[sampleIndex(leftX, y)];
  let r = inputPixels[sampleIndex(rightX, y)];
  let t = inputPixels[sampleIndex(x, topY)];
  let b = inputPixels[sampleIndex(x, bottomY)];
  return pack(
    sharpenChannel(red(c), red(l), red(r), red(t), red(b)),
    sharpenChannel(green(c), green(l), green(r), green(t), green(b)),
    sharpenChannel(blue(c), blue(l), blue(r), blue(t), blue(b)),
    alpha(c)
  );
}
fn blurChannel(center: u32, left: u32, right: u32, top: u32, bottom: u32, topLeft: u32, topRight: u32, bottomLeft: u32, bottomRight: u32) -> u32 {
  return (topLeft + topRight + bottomLeft + bottomRight + (top + bottom + left + right) * 2u + center * 4u) >> 4u;
}
fn smoothChannel(center: u32, blur: u32) -> u32 {
  let detail = i32(center) - i32(blur);
  return clampByte(i32(center) + (detail * 3) / 8);
}
fn smoothEnhancePixel(index: u32) -> u32 {
  let x = index % metadata.width;
  let y = index / metadata.width;
  let leftX = select(x - 1u, 0u, x == 0u);
  let rightX = min(x + 1u, metadata.width - 1u);
  let topY = select(y - 1u, 0u, y == 0u);
  let bottomY = min(y + 1u, metadata.height - 1u);
  let c = inputPixels[index];
  let l = inputPixels[sampleIndex(leftX, y)];
  let r = inputPixels[sampleIndex(rightX, y)];
  let t = inputPixels[sampleIndex(x, topY)];
  let b = inputPixels[sampleIndex(x, bottomY)];
  let tl = inputPixels[sampleIndex(leftX, topY)];
  let tr = inputPixels[sampleIndex(rightX, topY)];
  let bl = inputPixels[sampleIndex(leftX, bottomY)];
  let br = inputPixels[sampleIndex(rightX, bottomY)];
  let brg = blurChannel(red(c), red(l), red(r), red(t), red(b), red(tl), red(tr), red(bl), red(br));
  let bgg = blurChannel(green(c), green(l), green(r), green(t), green(b), green(tl), green(tr), green(bl), green(br));
  let bbg = blurChannel(blue(c), blue(l), blue(r), blue(t), blue(b), blue(tl), blue(tr), blue(bl), blue(br));
  return pack(
    smoothChannel(red(c), brg),
    smoothChannel(green(c), bgg),
    smoothChannel(blue(c), bbg),
    alpha(c)
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;
  if (index >= metadata.pixels) {
    return;
  }
  let pixel = inputPixels[index];
  outputPixels[index] = ${operation};
}
`;
}
