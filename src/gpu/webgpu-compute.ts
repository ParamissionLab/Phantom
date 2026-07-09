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
// WebGPU spec minimum for maxComputeWorkgroupsPerDimension is 65535.
// We use a conservative cap so large images are split into tiles.
const MAX_WORKGROUPS_PER_DISPATCH = 65535;
const GPU_TILE_PIXELS = MAX_WORKGROUPS_PER_DISPATCH * WORKGROUP_SIZE; // ~16.7 M px per tile

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

    const totalPixels = image.width * image.height;
    const resultData = new Uint8Array(image.data.byteLength);

    // Compile the shader pipeline once and reuse across tiles.
    const pipeline = this.device.createComputePipeline({
      layout: "auto",
      compute: {
        module: this.device.createShaderModule({ code: getShader(filter) }),
        entryPoint: "main",
      },
    });

    // Tile the image into vertical bands of at most GPU_TILE_PIXELS pixels so
    // dispatchWorkgroups never exceeds MAX_WORKGROUPS_PER_DISPATCH (65535).
    // For images < GPU_TILE_PIXELS pixels the loop runs exactly once.
    for (
      let pixelStart = 0;
      pixelStart < totalPixels;
      pixelStart += GPU_TILE_PIXELS
    ) {
      const pixelEnd = Math.min(pixelStart + GPU_TILE_PIXELS, totalPixels);
      const tilePixels = pixelEnd - pixelStart;
      const tileBytes = tilePixels * 4;

      const inputBuf = this.device.createBuffer({
        size: tileBytes,
        usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_DST,
      });
      const outputBuf = this.device.createBuffer({
        size: tileBytes,
        usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_SRC,
      });
      const metadataBuf = this.device.createBuffer({
        size: 16,
        usage: GPU_BUFFER_USAGE_UNIFORM | GPU_BUFFER_USAGE_COPY_DST,
      });
      const readbackBuf = this.device.createBuffer({
        size: tileBytes,
        usage: GPU_BUFFER_USAGE_MAP_READ | GPU_BUFFER_USAGE_COPY_DST,
      });

      // Upload the tile slice of the full image data.
      this.device.queue.writeBuffer(
        inputBuf,
        0,
        image.data.subarray(pixelStart * 4, pixelStart * 4 + tileBytes),
      );
      // Metadata: full image dimensions + tile pixel offset for neighbour sampling.
      this.device.queue.writeBuffer(
        metadataBuf,
        0,
        new Uint32Array([image.width, image.height, tilePixels, pixelStart]),
      );

      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputBuf } },
          { binding: 1, resource: { buffer: outputBuf } },
          { binding: 2, resource: { buffer: metadataBuf } },
        ],
      });

      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(tilePixels / WORKGROUP_SIZE),
      );
      pass.end();
      encoder.copyBufferToBuffer(outputBuf, 0, readbackBuf, 0, tileBytes);
      this.device.queue.submit([encoder.finish()]);

      await readbackBuf.mapAsync(GPU_MAP_MODE_READ);
      resultData.set(
        new Uint8Array(readbackBuf.getMappedRange()),
        pixelStart * 4,
      );
      readbackBuf.unmap();
    }

    return {
      width: image.width,
      height: image.height,
      data: resultData,
    };
  }
}

function getShader(filter: Exclude<PixelFilter, "identity">): string {
  switch (filter) {
    case "invert":
      return shaderBody("invertPixel(pixel, localIndex)");
    case "grayscale":
      return shaderBody("grayscalePixel(pixel, localIndex)");
    case "smoothEnhance":
      return shaderBody("smoothEnhancePixel(localIndex)");
    case "sharpen3x3":
      return shaderBody("sharpenPixel(localIndex)");
    case "boxBlur3x3":
      return shaderBody("boxBlurPixel(localIndex)");
    case "unsharpMask":
      return shaderBody("unsharpMaskPixel(localIndex)");
    default:
      filter satisfies never;
      throw new PhantomError(`Unsupported WebGPU filter: ${String(filter)}`);
  }
}

function shaderBody(operation: string): string {
  return `
struct Metadata {
  width: u32,       // full image width in pixels
  height: u32,      // full image height in pixels
  pixels: u32,      // number of pixels in this tile (may be < width*height)
  pixelOffset: u32, // global pixel index of the first pixel in this tile
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
// Clamp global (x, y) to image bounds, return tile-local index.
// globalPixelIndex - pixelOffset = tile-local read index.
fn sampleLocal(gx: u32, gy: u32) -> u32 {
  let cx = min(gx, metadata.width - 1u);
  let cy = min(gy, metadata.height - 1u);
  return cy * metadata.width + cx - metadata.pixelOffset;
}
fn invertPixel(pixel: u32, localIndex: u32) -> u32 {
  _ = localIndex;
  return pack(255u - red(pixel), 255u - green(pixel), 255u - blue(pixel), alpha(pixel));
}
fn grayscalePixel(pixel: u32, localIndex: u32) -> u32 {
  _ = localIndex;
  let luma = (red(pixel) * 77u + green(pixel) * 150u + blue(pixel) * 29u) >> 8u;
  return pack(luma, luma, luma, alpha(pixel));
}
fn sharpenChannel(center: u32, left: u32, right: u32, top: u32, bottom: u32) -> u32 {
  return clampByte(i32(center) * 5 - i32(left) - i32(right) - i32(top) - i32(bottom));
}
fn sharpenPixel(localIndex: u32) -> u32 {
  let gi = localIndex + metadata.pixelOffset;
  let x = gi % metadata.width;
  let y = gi / metadata.width;
  let leftX = select(x - 1u, 0u, x == 0u);
  let rightX = min(x + 1u, metadata.width - 1u);
  let topY = select(y - 1u, 0u, y == 0u);
  let bottomY = min(y + 1u, metadata.height - 1u);
  let c = inputPixels[localIndex];
  let l = inputPixels[sampleLocal(leftX, y)];
  let r = inputPixels[sampleLocal(rightX, y)];
  let t = inputPixels[sampleLocal(x, topY)];
  let b = inputPixels[sampleLocal(x, bottomY)];
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
fn unsharpChannel(center: u32, blur: u32) -> u32 {
  let detail = i32(center) - i32(blur);
  return clampByte(i32(center) + (detail * 5) / 8);
}
fn boxBlurChannel(topLeft: u32, top: u32, topRight: u32, left: u32, center: u32, right: u32, bottomLeft: u32, bottom: u32, bottomRight: u32) -> u32 {
  return (topLeft + top + topRight + left + center + right + bottomLeft + bottom + bottomRight + 4u) / 9u;
}
fn smoothEnhancePixel(localIndex: u32) -> u32 {
  let gi = localIndex + metadata.pixelOffset;
  let x = gi % metadata.width;
  let y = gi / metadata.width;
  let leftX = select(x - 1u, 0u, x == 0u);
  let rightX = min(x + 1u, metadata.width - 1u);
  let topY = select(y - 1u, 0u, y == 0u);
  let bottomY = min(y + 1u, metadata.height - 1u);
  let c = inputPixels[localIndex];
  let l = inputPixels[sampleLocal(leftX, y)];
  let r = inputPixels[sampleLocal(rightX, y)];
  let t = inputPixels[sampleLocal(x, topY)];
  let b = inputPixels[sampleLocal(x, bottomY)];
  let tl = inputPixels[sampleLocal(leftX, topY)];
  let tr = inputPixels[sampleLocal(rightX, topY)];
  let bl = inputPixels[sampleLocal(leftX, bottomY)];
  let br = inputPixels[sampleLocal(rightX, bottomY)];
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
fn unsharpMaskPixel(localIndex: u32) -> u32 {
  let gi = localIndex + metadata.pixelOffset;
  let x = gi % metadata.width;
  let y = gi / metadata.width;
  let leftX = select(x - 1u, 0u, x == 0u);
  let rightX = min(x + 1u, metadata.width - 1u);
  let topY = select(y - 1u, 0u, y == 0u);
  let bottomY = min(y + 1u, metadata.height - 1u);
  let c = inputPixels[localIndex];
  let l = inputPixels[sampleLocal(leftX, y)];
  let r = inputPixels[sampleLocal(rightX, y)];
  let t = inputPixels[sampleLocal(x, topY)];
  let b = inputPixels[sampleLocal(x, bottomY)];
  let tl = inputPixels[sampleLocal(leftX, topY)];
  let tr = inputPixels[sampleLocal(rightX, topY)];
  let bl = inputPixels[sampleLocal(leftX, bottomY)];
  let br = inputPixels[sampleLocal(rightX, bottomY)];
  let brg = blurChannel(red(c), red(l), red(r), red(t), red(b), red(tl), red(tr), red(bl), red(br));
  let bgg = blurChannel(green(c), green(l), green(r), green(t), green(b), green(tl), green(tr), green(bl), green(br));
  let bbg = blurChannel(blue(c), blue(l), blue(r), blue(t), blue(b), blue(tl), blue(tr), blue(bl), blue(br));
  return pack(
    unsharpChannel(red(c), brg),
    unsharpChannel(green(c), bgg),
    unsharpChannel(blue(c), bbg),
    alpha(c)
  );
}
fn boxBlurPixel(localIndex: u32) -> u32 {
  let gi = localIndex + metadata.pixelOffset;
  let x = gi % metadata.width;
  let y = gi / metadata.width;
  let leftX = select(x - 1u, 0u, x == 0u);
  let rightX = min(x + 1u, metadata.width - 1u);
  let topY = select(y - 1u, 0u, y == 0u);
  let bottomY = min(y + 1u, metadata.height - 1u);
  let c = inputPixels[localIndex];
  let l = inputPixels[sampleLocal(leftX, y)];
  let r = inputPixels[sampleLocal(rightX, y)];
  let t = inputPixels[sampleLocal(x, topY)];
  let b = inputPixels[sampleLocal(x, bottomY)];
  let tl = inputPixels[sampleLocal(leftX, topY)];
  let tr = inputPixels[sampleLocal(rightX, topY)];
  let bl = inputPixels[sampleLocal(leftX, bottomY)];
  let br = inputPixels[sampleLocal(rightX, bottomY)];
  return pack(
    boxBlurChannel(red(tl), red(t), red(tr), red(l), red(c), red(r), red(bl), red(b), red(br)),
    boxBlurChannel(green(tl), green(t), green(tr), green(l), green(c), green(r), green(bl), green(b), green(br)),
    boxBlurChannel(blue(tl), blue(t), blue(tr), blue(l), blue(c), blue(r), blue(bl), blue(b), blue(br)),
    alpha(c)
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let localIndex = globalId.x;
  if (localIndex >= metadata.pixels) {
    return;
  }
  let pixel = inputPixels[localIndex];
  outputPixels[localIndex] = ${operation};
}
`;
}
