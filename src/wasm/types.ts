import type {
  PixelFilter,
  RawRgbaImage,
  TileKernelBackend,
} from "../core/types.js";

export interface WasmKernelExports extends WebAssembly.Exports {
  readonly memory: WebAssembly.Memory;
  readonly rgba_invert: (
    inputPtr: number,
    outputPtr: number,
    pixels: number,
  ) => void;
  readonly rgba_grayscale: (
    inputPtr: number,
    outputPtr: number,
    pixels: number,
  ) => void;
  readonly rgba_sharpen3x3: (
    inputPtr: number,
    outputPtr: number,
    width: number,
    height: number,
  ) => void;
  readonly rgba_box_blur3x3: (
    inputPtr: number,
    outputPtr: number,
    width: number,
    height: number,
  ) => void;
  readonly rgba_unsharp_mask: (
    inputPtr: number,
    outputPtr: number,
    width: number,
    height: number,
  ) => void;
  readonly rgba_apply_alpha_mask: (
    inputPtr: number,
    maskPtr: number,
    outputPtr: number,
    pixels: number,
  ) => void;
  readonly rgba_filter_tile: (
    inputPtr: number,
    outputPtr: number,
    inputWidth: number,
    inputHeight: number,
    outputOffsetX: number,
    outputOffsetY: number,
    outputWidth: number,
    outputHeight: number,
    filter: number,
  ) => void;
  readonly rgba_estimate_tile_bytes: (
    tileWidth: number,
    tileHeight: number,
    overlap: number,
  ) => bigint;
}

export interface WasmKernelBackend extends TileKernelBackend {
  readonly memory: WebAssembly.Memory;
  readonly id: "zig-wasm";
  supportsFilter(filter: PixelFilter): boolean;
  estimateTileBytes(
    tileWidth: number,
    tileHeight: number,
    overlap: number,
  ): bigint;
  process(
    image: RawRgbaImage,
    filter: Exclude<PixelFilter, "identity">,
  ): RawRgbaImage;
  applyAlphaMask(image: RawRgbaImage, mask: Uint8Array): RawRgbaImage;
}
