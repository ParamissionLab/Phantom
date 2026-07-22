import {
  PhantomError,
  type PixelFilter,
  type RawRgbaImage,
  type TilePayload,
  type TileProcessor,
  type TileResult,
  assertPositiveInteger,
  assertRgbaLength,
} from "../core/types.js";
import type { WasmKernelBackend, WasmKernelExports } from "./types.js";

const PAGE_SIZE_BYTES = 64 * 1024;

/**
 * Instantiates the Zig WASM kernel backend.
 */
export async function instantiateWasmBackend(
  source: BufferSource | WebAssembly.Module,
): Promise<WasmKernelBackend> {
  // instantiate() resolves to an Instance for a compiled Module and to a
  // {module, instance} pair for raw bytes. The branch exists so each overload
  // is selected with its real argument type; the result is then normalized.
  const instantiated = await (source instanceof WebAssembly.Module
    ? WebAssembly.instantiate(source, {})
    : WebAssembly.instantiate(source, {}));

  const exports = (
    "instance" in instantiated
      ? instantiated.instance.exports
      : instantiated.exports
  ) as WasmKernelExports;
  validateExports(exports);
  return new ZigWasmBackend(exports);
}

/**
 * Adapts an instantiated WASM backend to the core tile-processing contract.
 */
export function createWasmTileProcessor(
  backend: WasmKernelBackend,
): TileProcessor {
  return {
    id: "zig-wasm",
    processTile(payload: TilePayload, filter: PixelFilter): TileResult {
      const outputOffsetX =
        payload.descriptor.output.x - payload.descriptor.input.x;
      const outputOffsetY =
        payload.descriptor.output.y - payload.descriptor.input.y;

      assertTileOffset(payload, outputOffsetX, outputOffsetY);

      return {
        descriptor: payload.descriptor,
        rgba: backend.processTile(
          payload.rgba,
          payload.descriptor.input.width,
          payload.descriptor.input.height,
          outputOffsetX,
          outputOffsetY,
          payload.descriptor.output.width,
          payload.descriptor.output.height,
          filter,
        ),
      };
    },
  };
}

class ZigWasmBackend implements WasmKernelBackend {
  public readonly memory: WebAssembly.Memory;
  // Cached heap view — reused across processTile calls to avoid per-tile
  // Uint8Array wrapper allocation. Invalidated when memory.grow() is called
  // (the ArrayBuffer reference changes after grow).
  private heapCache: Uint8Array | null = null;

  public constructor(private readonly exports: WasmKernelExports) {
    this.memory = exports.memory;
  }

  private getHeap(): Uint8Array {
    // memory.buffer is replaced after every grow(); check reference equality.
    if (this.heapCache === null || this.heapCache.buffer !== this.memory.buffer) {
      this.heapCache = new Uint8Array(this.memory.buffer);
    }
    return this.heapCache;
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

    const heap = this.getHeap();
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

    // Use Uint8Array constructor with shared buffer — copies only the output region
    // into a new independent buffer that won't be invalidated by future memory.grow()
    const result = new Uint8Array(byteLength);
    result.set(new Uint8Array(this.memory.buffer, outputPtr, byteLength));

    return {
      width: image.width,
      height: image.height,
      data: result,
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
    assertPositiveInteger(inputWidth, "inputWidth");
    assertPositiveInteger(inputHeight, "inputHeight");
    assertPositiveInteger(outputWidth, "outputWidth");
    assertPositiveInteger(outputHeight, "outputHeight");

    const expectedInput = inputWidth * inputHeight * 4;
    if (input.length !== expectedInput) {
      throw new PhantomError(
        `Tile input length mismatch: expected ${expectedInput}, got ${input.length}.`,
      );
    }

    const outputBytes = outputWidth * outputHeight * 4;
    const inputPtr = 0;
    const outputPtr = input.length;
    this.ensureCapacity(input.length + outputBytes);

    const heap = this.getHeap();
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

    // Direct typed-array view copy — avoids ArrayBuffer.prototype.slice overhead
    const result = new Uint8Array(outputBytes);
    result.set(new Uint8Array(this.memory.buffer, outputPtr, outputBytes));
    return result;
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
    const outputLength = image.data.length;
    this.ensureCapacity(outputPtr + outputLength);
    const heap = this.getHeap();
    heap.set(image.data, inputPtr);
    heap.set(mask, maskPtr);
    this.exports.rgba_apply_alpha_mask(inputPtr, maskPtr, outputPtr, pixels);

    // Direct view copy — faster than heap.slice which creates intermediate ArrayBuffer
    const result = new Uint8Array(outputLength);
    result.set(new Uint8Array(this.memory.buffer, outputPtr, outputLength));

    return {
      width: image.width,
      height: image.height,
      data: result,
    };
  }

  private ensureCapacity(requiredBytes: number): void {
    if (this.memory.buffer.byteLength >= requiredBytes) {
      return;
    }

    const missingBytes = requiredBytes - this.memory.buffer.byteLength;
    const pages = Math.ceil(missingBytes / PAGE_SIZE_BYTES);
    this.memory.grow(pages);
    // Invalidate cached heap view — memory.grow() replaces the ArrayBuffer.
    this.heapCache = null;
  }
}

function assertTileOffset(
  payload: TilePayload,
  outputOffsetX: number,
  outputOffsetY: number,
): void {
  assertPositiveInteger(payload.descriptor.input.width, "input.width");
  assertPositiveInteger(payload.descriptor.input.height, "input.height");
  assertPositiveInteger(payload.descriptor.output.width, "output.width");
  assertPositiveInteger(payload.descriptor.output.height, "output.height");

  if (
    outputOffsetX < 0 ||
    outputOffsetY < 0 ||
    outputOffsetX + payload.descriptor.output.width >
      payload.descriptor.input.width ||
    outputOffsetY + payload.descriptor.output.height >
      payload.descriptor.input.height
  ) {
    throw new PhantomError(
      `Tile output rectangle must be contained inside its input rectangle: ${JSON.stringify(
        payload.descriptor,
      )}.`,
    );
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
