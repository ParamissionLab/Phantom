import {
  PhantomError,
  type PixelFilter,
  type RawRgbaImage,
  assertPositiveInteger,
  assertRgbaLength,
} from "../core/types.js";
import type { WasmKernelBackend, WasmKernelExports } from "./types.js";

const PAGE_SIZE_BYTES = 64 * 1024;
const WASM_U32_MAX = 0xffff_ffff;
const SUPPORTED_FILTERS: ReadonlySet<PixelFilter> = new Set([
  "identity",
  "invert",
  "grayscale",
  "smoothEnhance",
  "sharpen3x3",
  "boxBlur3x3",
  "unsharpMask",
]);

/**
 * Instantiates the optional Zig WASM backend.
 */
export async function instantiateZigBackend(
  source: BufferSource | WebAssembly.Module,
): Promise<WasmKernelBackend> {
  const instance =
    source instanceof WebAssembly.Module
      ? await WebAssembly.instantiate(source, {})
      : await WebAssembly.instantiate(source, {});

  const exports = (
    "instance" in instance ? instance.instance.exports : instance.exports
  ) as WasmKernelExports;
  validateExports(exports);
  return new ZigWasmBackend(exports);
}

class ZigWasmBackend implements WasmKernelBackend {
  public readonly id = "zig-wasm";
  public readonly memory: WebAssembly.Memory;

  public constructor(private readonly exports: WasmKernelExports) {
    this.memory = exports.memory;
  }

  public supportsFilter(filter: PixelFilter): boolean {
    return SUPPORTED_FILTERS.has(filter);
  }

  public estimateTileBytes(
    tileWidth: number,
    tileHeight: number,
    overlap: number,
  ): bigint {
    assertWasmU32(tileWidth, "tileWidth", false);
    assertWasmU32(tileHeight, "tileHeight", false);
    assertWasmU32(overlap, "overlap", true);
    return this.exports.rgba_estimate_tile_bytes(
      tileWidth,
      tileHeight,
      overlap,
    );
  }

  public process(
    image: RawRgbaImage,
    filter: Exclude<PixelFilter, "identity">,
  ): RawRgbaImage {
    assertRgbaLength(image);

    const byteLength = image.data.length;
    const inputPtr = 0;
    const outputPtr = byteLength;
    this.ensureCapacity(byteLength * 2);

    const heap = new Uint8Array(this.memory.buffer);
    heap.set(image.data, inputPtr);

    switch (filter) {
      case "invert":
        this.exports.rgba_invert(
          inputPtr,
          outputPtr,
          image.width * image.height,
        );
        break;
      case "grayscale":
        this.exports.rgba_grayscale(
          inputPtr,
          outputPtr,
          image.width * image.height,
        );
        break;
      case "smoothEnhance":
        this.exports.rgba_filter_tile(
          inputPtr,
          outputPtr,
          image.width,
          image.height,
          0,
          0,
          image.width,
          image.height,
          filterToCode(filter),
        );
        break;
      case "sharpen3x3":
        this.exports.rgba_sharpen3x3(
          inputPtr,
          outputPtr,
          image.width,
          image.height,
        );
        break;
      case "boxBlur3x3":
        this.exports.rgba_box_blur3x3(
          inputPtr,
          outputPtr,
          image.width,
          image.height,
        );
        break;
      case "unsharpMask":
        this.exports.rgba_unsharp_mask(
          inputPtr,
          outputPtr,
          image.width,
          image.height,
        );
        break;
      default:
        filter satisfies never;
        throw new PhantomError(`Unsupported WASM filter: ${String(filter)}`);
    }

    return {
      width: image.width,
      height: image.height,
      data: heap.slice(outputPtr, outputPtr + byteLength),
    };
  }

  public processTile(
    input: Uint8Array,
    inputWidth: number,
    inputHeight: number,
    outputOffsetX: number,
    outputOffsetY: number,
    outputWidth: number,
    outputHeight: number,
    filter: PixelFilter,
  ): Uint8Array {
    assertWasmU32(inputWidth, "inputWidth", false);
    assertWasmU32(inputHeight, "inputHeight", false);
    assertWasmU32(outputWidth, "outputWidth", false);
    assertWasmU32(outputHeight, "outputHeight", false);
    assertWasmU32(outputOffsetX, "outputOffsetX", true);
    assertWasmU32(outputOffsetY, "outputOffsetY", true);

    if (
      outputOffsetX + outputWidth > inputWidth ||
      outputOffsetY + outputHeight > inputHeight
    ) {
      throw new PhantomError("Output tile window is outside the input tile.");
    }

    const expectedInput = inputWidth * inputHeight * 4;
    if (!Number.isSafeInteger(expectedInput)) {
      throw new PhantomError("Input tile dimensions exceed safe WASM memory.");
    }
    if (input.length !== expectedInput) {
      throw new PhantomError(
        `Tile input length mismatch: expected ${expectedInput}, got ${input.length}.`,
      );
    }

    const outputBytes = outputWidth * outputHeight * 4;
    if (!Number.isSafeInteger(outputBytes)) {
      throw new PhantomError("Output tile dimensions exceed safe WASM memory.");
    }
    const inputPtr = 0;
    const outputPtr = input.length;
    this.ensureCapacity(input.length + outputBytes);

    const heap = new Uint8Array(this.memory.buffer);
    heap.set(input, inputPtr);
    this.exports.rgba_filter_tile(
      inputPtr,
      outputPtr,
      inputWidth,
      inputHeight,
      outputOffsetX,
      outputOffsetY,
      outputWidth,
      outputHeight,
      filterToCode(filter),
    );

    return heap.slice(outputPtr, outputPtr + outputBytes);
  }

  public applyAlphaMask(image: RawRgbaImage, mask: Uint8Array): RawRgbaImage {
    assertRgbaLength(image);
    const pixels = image.width * image.height;
    if (mask.length !== pixels) {
      throw new PhantomError(
        `Alpha mask length mismatch: expected ${pixels}, got ${mask.length}.`,
      );
    }

    const inputPtr = 0;
    const maskPtr = image.data.length;
    const outputPtr = maskPtr + mask.length;
    this.ensureCapacity(outputPtr + image.data.length);
    const heap = new Uint8Array(this.memory.buffer);
    heap.set(image.data, inputPtr);
    heap.set(mask, maskPtr);
    this.exports.rgba_apply_alpha_mask(inputPtr, maskPtr, outputPtr, pixels);

    return {
      width: image.width,
      height: image.height,
      data: heap.slice(outputPtr, outputPtr + image.data.length),
    };
  }

  private ensureCapacity(requiredBytes: number): void {
    if (this.memory.buffer.byteLength >= requiredBytes) {
      return;
    }

    const missingBytes = requiredBytes - this.memory.buffer.byteLength;
    const pages = Math.ceil(missingBytes / PAGE_SIZE_BYTES);
    this.memory.grow(pages);
  }
}

function assertWasmU32(value: number, name: string, allowZero: boolean): void {
  assertPositiveInteger(value + (allowZero ? 1 : 0), name);
  if (!Number.isSafeInteger(value) || value > WASM_U32_MAX) {
    throw new PhantomError(`${name} must fit in a WebAssembly u32.`);
  }
}

function validateExports(
  exports: WebAssembly.Exports,
): asserts exports is WasmKernelExports {
  for (const name of [
    "memory",
    "rgba_invert",
    "rgba_grayscale",
    "rgba_sharpen3x3",
    "rgba_box_blur3x3",
    "rgba_unsharp_mask",
    "rgba_apply_alpha_mask",
    "rgba_filter_tile",
    "rgba_estimate_tile_bytes",
  ]) {
    if (!(name in exports)) {
      throw new PhantomError(`Zig WASM module is missing export: ${name}.`);
    }
  }
}

function filterToCode(filter: PixelFilter): number {
  switch (filter) {
    case "identity":
      return 0;
    case "invert":
      return 1;
    case "grayscale":
      return 2;
    case "smoothEnhance":
      return 4;
    case "sharpen3x3":
      return 3;
    case "boxBlur3x3":
      return 5;
    case "unsharpMask":
      return 6;
    default:
      filter satisfies never;
      throw new PhantomError(`Unsupported WASM filter: ${String(filter)}`);
  }
}
