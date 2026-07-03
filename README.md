# phantom

[![CI](https://github.com/ParamissionLab/phantom/actions/workflows/ci.yml/badge.svg)](https://github.com/ParamissionLab/phantom/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Maintained by [Paramission Lab](https://github.com/ParamissionLab).

Phantom is a TypeScript-first RGBA image-processing SDK for large browser and
Node.js workloads. It keeps memory bounded with overlap-aware tiles, provides a
deterministic CPU baseline, and exposes optional browser workers, WebGPU, Zig
WebAssembly, and AI background-removal paths.

## Table of Contents

- [When to use Phantom](#when-to-use-phantom)
- [Installation](#installation)
- [Runtime requirements](#runtime-requirements)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Package entry points](#package-entry-points)
- [Default API](#default-api)
- [Raw RGBA utilities](#raw-rgba-utilities)
- [Filters and tile processing](#filters-and-tile-processing)
- [Masks and background replacement](#masks-and-background-replacement)
- [Image conversion and optimization](#image-conversion-and-optimization)
- [AI background removal](#ai-background-removal)
- [Asset planning](#asset-planning)
- [Workers](#workers)
- [GPU and browser capabilities](#gpu-and-browser-capabilities)
- [Zig WASM backend](#zig-wasm-backend)
- [Error handling](#error-handling)
- [Development](#development)
- [Release process](#release-process)
- [Operational limits](#operational-limits)

## When to Use Phantom

Use Phantom when you need:

- A strict TypeScript SDK for raw RGBA image workflows.
- Tile-first processing for large images where full-frame operations are too
  expensive.
- Safe convolution filters that preserve tile edges with explicit overlap.
- A simple public facade for common editing tasks.
- Lower-level `TileSource` and `TileSink` contracts for custom decoders,
  encoders, storage, or streaming integrations.
- Optional browser acceleration through workers, WebGPU, or Zig WASM.
- Optional AI background removal that stays outside the core import path.

Start with `phantom.edit(image)` for product features. Drop down to
`processRawImage()`, `processTileSource()`, workers, GPU, or WASM only when you
need more control over memory, execution, or integration boundaries.

## Installation

Install from npm:

```bash
npm install @paramission-lab/phantom
```

The unscoped `phantom` package name is already used on npm, so the public
package is scoped under Paramission Lab while the SDK brand remains Phantom.

Install directly from GitHub when you need a specific tag or commit:

```bash
npm install git+https://github.com/ParamissionLab/phantom.git#<release-tag>
```

For a private organization repository configured with SSH access:

```bash
npm install git+ssh://git@github.com/ParamissionLab/phantom.git#<release-tag>
```

Replace `<release-tag>` with a published Git tag from the repository releases.
Pin a release tag or full commit SHA instead of `main` so installs remain
reproducible. Git installs run the package `prepare` script and compile the
TypeScript build. The Zig WASM binary is not built automatically for Git
installs; build it explicitly when you need that backend.

## Runtime Requirements

| Area                  | Requirement                                                                     |
| --------------------- | ------------------------------------------------------------------------------- |
| Package format        | ESM                                                                             |
| Node.js               | `>=22` for the supported development and CI environment                         |
| TypeScript target     | ES2022                                                                          |
| Core image processing | Works without DOM APIs                                                          |
| Browser encoding      | Requires `Canvas`, `OffscreenCanvas`, or document canvas APIs                   |
| Browser workers       | Requires module workers                                                         |
| Shared tile memory    | Requires `SharedArrayBuffer`; cross-origin isolation is required in browsers    |
| WebGPU                | Requires a browser/runtime with `navigator.gpu`                                 |
| AI background removal | Requires browser image APIs and `@huggingface/transformers` optional dependency |
| Zig WASM build        | Requires Zig `0.16.0`                                                           |

The core import does not initialize WebGPU, workers, WASM, or AI inference.

## Quick Start

Use the default facade for everyday editing:

```ts
import phantom, { type RawRgbaImage } from "@paramission-lab/phantom";

const input: RawRgbaImage = {
  width: 2,
  height: 1,
  data: Uint8Array.from([10, 20, 30, 255, 200, 210, 220, 255]),
};

const output = await phantom
  .edit(input)
  .resize(512, 256)
  .filter("smoothEnhance")
  .run();

const plan = await phantom.process(output).plan({ goal: "delivery" });
console.log(plan.encode.format, plan.tileSize);
```

Use named imports when direct functions are clearer:

```ts
import {
  applyFilter,
  createRawRgbaImage,
  resizeImage,
} from "@paramission-lab/phantom";

const image = createRawRgbaImage(
  { width: 800, height: 600 },
  { r: 255, g: 255, b: 255 },
);

const preview = resizeImage(image, 320, 240);
const enhanced = await applyFilter(preview, "unsharpMask");
```

Use Phantom with a browser canvas:

```ts
import phantom from "@paramission-lab/phantom";

const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const output = await phantom.applyFilter(
  {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8Array(imageData.data),
  },
  "sharpen3x3",
);

ctx.putImageData(
  new ImageData(
    new Uint8ClampedArray(output.data),
    output.width,
    output.height,
  ),
  0,
  0,
);
```

## Core Concepts

### RawRgbaImage

Most core APIs use this shape:

```ts
interface RawRgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}
```

`data` must contain exactly `width * height * 4` bytes in RGBA order. Phantom
validates dimensions and buffer lengths and throws `PhantomError` for SDK
validation failures.

### Tiles and Overlap

Phantom processes large images as rectangular tiles. Convolution filters need
neighboring pixels, so each tile can read a larger input rectangle and write only
its non-overlapped output rectangle. This is how Phantom avoids tile-edge
artifacts.

High-level helpers such as `applyFilter()` and `applyFilters()` choose safe
overlap values automatically. Lower-level processing APIs expose `tileSize` and
`overlap` when you need exact control.

### CPU Baseline

The TypeScript CPU kernels are the correctness baseline. Worker, WebGPU, and
WASM paths should match the CPU behavior for the same filter and tile region.

## Package Entry Points

| Import                                         | Purpose                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@paramission-lab/phantom`                     | Core facade, raw RGBA utilities, filters, masks, planning, pipeline APIs, and re-exported optional helpers |
| `@paramission-lab/phantom/ai`                  | Browser AI background-removal facade                                                                       |
| `@paramission-lab/phantom/gpu`                 | WebGPU compute, WebGPU renderer, WebGL renderer, and capability detection                                  |
| `@paramission-lab/phantom/wasm`                | Zig WebAssembly loader and kernel adapter types                                                            |
| `@paramission-lab/phantom/workers`             | `TileWorkerPool` and `SharedTileBuffer`                                                                    |
| `@paramission-lab/phantom/worker`              | Short browser worker module path for `TileWorkerPool`                                                      |
| `@paramission-lab/phantom/workers/tile-worker` | Long-form alias for the same worker module                                                                 |

Prefer subpath imports for browser-only modules when you want bundlers to keep
optional code separated.

## Default API

The default export is the `phantom` facade:

```ts
import phantom from "@paramission-lab/phantom";
```

| Function                                      | Description                                                   |
| --------------------------------------------- | ------------------------------------------------------------- |
| `makeImage(width, height, color?)`            | Allocate a raw RGBA image with an optional fill color         |
| `edit(image)`                                 | Start a chainable edit pipeline                               |
| `process(image)`                              | Alias for `edit(image)`                                       |
| `cropImage(image, rect)`                      | Crop into a new raw RGBA image                                |
| `resizeImage(image, width, height, options?)` | Resize with `bilinear` by default or `nearest` when requested |
| `applyFilter(image, filter?, options?)`       | Apply one filter with safe overlap defaults                   |
| `applyFilters(image, filters, options?)`      | Apply multiple filters in order                               |
| `applyMask(image, mask, options?)`            | Apply a provider-generated alpha mask                         |
| `replaceBackground(image, color)`             | Flatten transparent pixels onto a solid RGB color             |
| `planAsset(image, options?)`                  | Create a processing and encoding recipe                       |
| `convertImage(input, options?)`               | Convert browser image inputs through canvas encoding          |
| `optimizeImage(input, options?)`              | Re-encode browser images with conservative defaults           |

### Edit Pipeline

`phantom.edit(image)` accepts a `RawRgbaImage` or `Promise<RawRgbaImage>` and
returns a chainable pipeline.

| Method                            | Description                                        |
| --------------------------------- | -------------------------------------------------- |
| `crop(rect)`                      | Crop with `{ x, y, width, height }`                |
| `resize(width, height, options?)` | Resize with `bilinear` or `nearest`                |
| `filter(filter?, options?)`       | Apply one filter, defaulting to `smoothEnhance`    |
| `filters(filters, options?)`      | Apply multiple filters in order                    |
| `mask(mask, options?)`            | Apply an alpha mask with refinement                |
| `background(color)`               | Replace transparency with a solid color            |
| `plan(options?)`                  | Resolve a `PhantomAssetPlan` for the current image |
| `run()`                           | Resolve the edited `RawRgbaImage`                  |

Example:

```ts
const output = await phantom
  .edit(input)
  .crop({ x: 100, y: 80, width: 1200, height: 900 })
  .resize(600, 450, { method: "bilinear" })
  .filters(["smoothEnhance", "unsharpMask"], {
    tileSize: 512,
    onProgress: ({ percent }) => console.log(percent.toFixed(0)),
  })
  .background({ r: 255, g: 255, b: 255 })
  .run();
```

## Raw RGBA Utilities

```ts
import {
  cloneRawImage,
  createRawRgbaImage,
  cropRawImage,
  resizeRawImage,
} from "@paramission-lab/phantom";
```

| Function                                      | Description                                       |
| --------------------------------------------- | ------------------------------------------------- |
| `createRawRgbaImage(dimensions, color?)`      | Allocate a transparent or solid-color RGBA buffer |
| `cloneRawImage(image)`                        | Return a defensive copy                           |
| `cropRawImage(image, rect)`                   | Copy a rectangular region                         |
| `resizeRawImage(image, dimensions, options?)` | Resize with `bilinear` or `nearest`               |

`resizeImage(image, width, height, options?)` is the compact facade signature for
`resizeRawImage()`.

## Filters and Tile Processing

### Supported Filters

```ts
import {
  getPixelFilterOverlap,
  getPixelFilterProfile,
  listPixelFilters,
} from "@paramission-lab/phantom";
```

| Filter          | Label           | Overlap | Notes                            |
| --------------- | --------------- | ------- | -------------------------------- |
| `identity`      | Identity        | `0`     | Copy pixels                      |
| `invert`        | Invert          | `0`     | Invert RGB, preserve alpha       |
| `grayscale`     | Grayscale       | `0`     | Fixed-point luminance            |
| `smoothEnhance` | Natural Enhance | `1`     | Local contrast enhancement       |
| `sharpen3x3`    | Crisp Sharpen   | `1`     | 3x3 sharpen                      |
| `boxBlur3x3`    | Soft Blur       | `1`     | 3x3 blur                         |
| `unsharpMask`   | Phantom Clarity | `1`     | Delivery-oriented clarity filter |

Use `listPixelFilters()` to drive UI controls from metadata instead of hardcoding
labels.

### High-Level Filtering

```ts
import { applyFilter, applyFilters } from "@paramission-lab/phantom";

const one = await applyFilter(input, "smoothEnhance", { tileSize: 512 });
const many = await applyFilters(input, ["smoothEnhance", "unsharpMask"]);
```

Options:

| Option               | Description                                                                    |
| -------------------- | ------------------------------------------------------------------------------ |
| `tileSize`           | Tile edge length in pixels                                                     |
| `backend`            | Optional tile backend such as the Zig WASM backend                             |
| `backendFailureMode` | `strict` throws backend errors; `fallback` reroutes failed tiles to TypeScript |
| `signal`             | Abort signal checked between tiles                                             |
| `onProgress`         | Receives completed tile count, total tiles, percent, and tile descriptor       |

### Low-Level Processing

```ts
import {
  processRawImage,
  processRawImagePipeline,
  processRawImageWithStats,
} from "@paramission-lab/phantom";

const output = await processRawImage(input, {
  filter: "sharpen3x3",
  tileSize: 512,
  overlap: 1,
});

const { image, stats } = await processRawImageWithStats(input, {
  filter: "smoothEnhance",
  onProgress: ({ completedTiles, totalTiles }) => {
    console.log(`${completedTiles}/${totalTiles}`);
  },
});

console.log(stats.backendTiles, stats.fallbackTiles);

const recipe = await processRawImagePipeline(
  input,
  [{ filter: "smoothEnhance" }, { filter: "unsharpMask" }],
  { tileSize: 512 },
);
```

`processRawImagePipeline()` requires at least one step. If you configure an
overlap smaller than a filter requires, Phantom throws `PhantomError`. When a
custom backend is supplied, `stats.backendTiles` and `stats.fallbackTiles` show
how many tiles used the backend or rerouted through the TypeScript reference
kernel.

### Custom Sources and Sinks

Use `TileSource` and `TileSink` when integrating your own decoder, storage
layer, or encoder:

```ts
import {
  processTileSource,
  type TileSink,
  type TileSource,
} from "@paramission-lab/phantom";

const source: TileSource = {
  read(rect) {
    return readRgbaBytesFromDecoder(rect);
  },
};

const sink: TileSink = {
  write(rect, data) {
    writeRgbaBytesToEncoder(rect, data);
  },
};

await processTileSource({ width: 32000, height: 32000 }, source, sink, {
  filter: "smoothEnhance",
  tileSize: 512,
  overlap: 1,
});
```

## Masks and Background Replacement

```ts
import {
  applyAlphaMask,
  refineAlphaMask,
  replaceTransparentBackground,
} from "@paramission-lab/phantom";
```

`AlphaMask` is a one-channel mask:

```ts
interface AlphaMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}
```

Apply a segmentation mask from any provider:

```ts
const cutout = applyAlphaMask(input, mask, {
  threshold: 8,
  softness: 24,
  featherRadius: 2,
  edgeSensitivity: 48,
});

console.log(cutout.removedPixels, cutout.partialPixels);
```

Mask refinement behavior:

| Option            | Default | Description                                  |
| ----------------- | ------- | -------------------------------------------- |
| `threshold`       | `4`     | Discard mask noise below this alpha value    |
| `softness`        | `12`    | Width of the transition around the threshold |
| `featherRadius`   | `2`     | Color-guided edge filter radius, capped at 3 |
| `edgeSensitivity` | `48`    | RGB distance used for edge-aware mask mixing |

Flatten transparent pixels onto a background:

```ts
const jpegReady = replaceTransparentBackground(cutout, {
  r: 255,
  g: 255,
  b: 255,
});
```

## Image Conversion and Optimization

Browser image conversion uses host canvas encoders:

```ts
import {
  canEncodeImageFormat,
  convertImageFile,
  getImageFormatProfile,
  listImageFormats,
  optimizeImageFile,
} from "@paramission-lab/phantom";

const webp = await optimizeImageFile(file, {
  format: "webp",
  quality: 0.92,
});

const png = await convertImageFile(file, { format: "png" });
```

Recognized formats:

| Format         | MIME type    | Alpha | Browser encode |
| -------------- | ------------ | ----- | -------------- |
| `png`          | `image/png`  | Yes   | Yes            |
| `jpeg` / `jpg` | `image/jpeg` | No    | Yes            |
| `webp`         | `image/webp` | Yes   | Yes            |
| `avif`         | `image/avif` | Yes   | Yes            |
| `bmp`          | `image/bmp`  | No    | No             |
| `gif`          | `image/gif`  | Yes   | No             |
| `tiff`         | `image/tiff` | Yes   | No             |

`bmp`, `gif`, and `tiff` can be identified by metadata helpers, but
`convertImageFile()` and `encodeRawImage()` throw if the browser cannot encode
the requested format.

Supported browser inputs:

- `Blob` or `File`
- URL string or `URL`
- `HTMLCanvasElement`
- `OffscreenCanvas`
- `ImageBitmap`
- `ImageData`
- `RawRgbaImage`

For formats without alpha support, pass `background` to flatten transparency:

```ts
const jpeg = await convertImageFile(cutout, {
  format: "jpeg",
  quality: 0.9,
  background: { r: 255, g: 255, b: 255 },
});
```

`optimizeImageFile()` defaults to `keepOriginalWhenSmaller: true` for `Blob`
inputs, so it returns the original blob when re-encoding would increase size.

## AI Background Removal

The AI entry point is browser-oriented and lazy-loads
`@huggingface/transformers` only when used:

```ts
import ai from "@paramission-lab/phantom/ai";

const cutout = await ai.removeBackground(imageCanvas, {
  onProgress: (progress) => console.log(progress.label, progress.percent),
});
```

One-call API:

```ts
import { removeBackgroundAi } from "@paramission-lab/phantom/ai";

const result = await removeBackgroundAi(imageCanvas, {
  backend: "auto",
  maskCutoff: 38,
  softness: 54,
  featherRadius: 2,
  subjectGuard: 70,
});

console.log(result.backend, result.model, result.removedPixels);
```

Reuse one loaded model across many images:

```ts
import { applyAlphaMask } from "@paramission-lab/phantom";
import { createPhantomAi } from "@paramission-lab/phantom/ai";

const remover = createPhantomAi();
await remover.preload();

try {
  const { mask } = await remover.createMask(imageCanvas);
  const cutout = applyAlphaMask(input, mask);
} finally {
  await remover.dispose();
}
```

Configuration:

| Option            | Default                     | Description                                               |
| ----------------- | --------------------------- | --------------------------------------------------------- |
| `model`           | `onnx-community/ormbg-ONNX` | Transformers.js background-removal model                  |
| `backend`         | `auto`                      | `auto`, `webgpu`, or `wasm`                               |
| `webgpuDtype`     | `fp16`                      | WebGPU precision: `fp16` or `fp32`                        |
| `wasmDtype`       | `q8`                        | CPU/WASM fallback precision: `q4`, `q8`, or `fp32`        |
| `maskCutoff`      | `38`                        | Demo-style foreground cutoff                              |
| `subjectGuard`    | `70`                        | Demo-style guard percentage used to tune edge sensitivity |
| `threshold`       | derived from `maskCutoff`   | Direct alpha-mask threshold override                      |
| `softness`        | `54`                        | Edge transition width                                     |
| `featherRadius`   | `2`                         | Color-guided refinement radius                            |
| `edgeSensitivity` | derived from `subjectGuard` | Direct edge sensitivity override                          |
| `onProgress`      | none                        | Model loading and inference progress callback             |

Concurrent `preload()` and `createMask()` calls on the same
`BrowserBackgroundRemover` share one model initialization promise. Call
`dispose()` when the model is no longer needed.

The default model is Apache-2.0 licensed. Model weights are downloaded on first
AI use and cached by the browser runtime when available. Review model licenses
before selecting a different model.

## Asset Planning

`createPhantomAssetPlan()` returns a production recipe for filters, tile size,
memory estimates, and output encoding:

```ts
import phantom, { createPhantomAssetPlan } from "@paramission-lab/phantom";

const plan = createPhantomAssetPlan(input, {
  goal: "delivery",
  maxWorkerBytes: 32 * 1024 * 1024,
});

const processed = await phantom.applyFilters(input, plan.filters, {
  tileSize: plan.tileSize,
});
```

Goals:

| Goal                 | Default filters | Recommended format                     |
| -------------------- | --------------- | -------------------------------------- |
| `delivery`           | `smoothEnhance` | `jpeg` without alpha, otherwise `webp` |
| `archive`            | none            | `png`                                  |
| `preview`            | `smoothEnhance` | `webp`                                 |
| `transparent-cutout` | `unsharpMask`   | `webp`                                 |

The plan also reports `pixels`, `rgbaBytes`, transparency, processing estimates,
selected `tileSize`, required `overlap`, and encoder options.

## Workers

Use `TileWorkerPool` in browser apps that can run module workers:

```ts
import { TileWorkerPool } from "@paramission-lab/phantom/workers";

const workerUrl = new URL("@paramission-lab/phantom/worker", import.meta.url);
const pool = new TileWorkerPool(workerUrl, 4);

try {
  const result = await pool.runTile(tilePayload, "smoothEnhance");
} finally {
  pool.dispose();
}
```

`TileWorkerPool` transfers tile `Uint8Array` buffers to workers. If one worker
fails, only tasks assigned to that worker are rejected; unrelated in-flight
tasks can still complete.

Use `SharedTileBuffer` when the runtime supports shared memory:

```ts
import { SharedTileBuffer } from "@paramission-lab/phantom/workers";

const tileMemory = new SharedTileBuffer(512 * 512 * 4, {
  preferShared: true,
});

const tileBytes = tileMemory.view();
console.log(tileMemory.shared);
```

Set `requireShared: true` when falling back to `ArrayBuffer` would be incorrect
for your workload.

## GPU and Browser Capabilities

```ts
import { detectCapabilities } from "@paramission-lab/phantom/gpu";

const capabilities = detectCapabilities();
console.log(capabilities.backend);
```

`detectCapabilities()` returns:

| Field                 | Description                             |
| --------------------- | --------------------------------------- |
| `backend`             | `webgpu`, `wasm-simd`, or `cpu`         |
| `webgpu`              | Whether `navigator.gpu` is available    |
| `sharedArrayBuffer`   | Whether `SharedArrayBuffer` exists      |
| `crossOriginIsolated` | Whether the browser context is isolated |
| `hardwareConcurrency` | Reported worker concurrency or `1`      |

The GPU package also exports `WebGpuComputeBackend`, `WebGpuRgbaRenderer`, and
`WebGlRgbaRenderer` for browser integrations that need direct rendering or
compute control.

## Zig WASM Backend

Build the TypeScript output and Zig kernel:

```bash
npm run build
npm run build:wasm
```

Instantiate the backend and route the normal high-level pipeline through Zig:

```ts
import { applyFilter, editImage } from "@paramission-lab/phantom";
import { instantiateZigBackend } from "@paramission-lab/phantom/wasm";

const bytes = await fetch("/phantom_kernel.wasm").then((response) =>
  response.arrayBuffer(),
);

const backend = await instantiateZigBackend(bytes);
const output = await applyFilter(input, "grayscale", { backend });
const enhanced = await editImage(input)
  .filter("smoothEnhance", { backend })
  .filter("unsharpMask", { backend })
  .run();

console.log(backend.id, backend.supportsFilter("unsharpMask"));
console.log(backend.estimateTileBytes(512, 512, 1));
```

Passing `backend` to `applyFilter()`, `applyFilters()`, `editImage().filter()`,
or `processRawImage()` keeps the normal bounded-memory tile planner and runs each
kernel in Zig. Direct whole-image, tile, alpha-mask, filter capability, and tile
scratch-estimate methods remain available through `WasmKernelBackend`. The
TypeScript kernels are the default path when no backend is supplied. Set
`backendFailureMode: "fallback"` when you want failed or unsupported backend
tiles to reroute through the TypeScript reference kernel; the default `strict`
mode surfaces backend failures immediately. The release package ships `dist`;
the `zig/` source tree and root `build.zig` are for repository development.

## Error Handling

Use `PhantomError` for SDK validation and backend failures:

```ts
import { PhantomError, processRawImage } from "@paramission-lab/phantom";

try {
  await processRawImage(input, {
    filter: "sharpen3x3",
    overlap: 0,
  });
} catch (error) {
  if (error instanceof PhantomError) {
    console.error(error.message);
  } else {
    throw error;
  }
}
```

Common validation failures:

- Invalid dimensions or rectangle bounds.
- RGBA data length does not equal `width * height * 4`.
- Unsupported filter or image format.
- Convolution filter overlap is too small.
- Browser canvas, fetch, worker, WebGPU, or shared-memory APIs are unavailable.

## Architecture

| Layer                  | Responsibility                                                    |
| ---------------------- | ----------------------------------------------------------------- |
| Decoder or caller      | Provides source pixels from browser, Node.js, or a custom decoder |
| `TileSource`           | Reads bounded rectangular RGBA regions                            |
| Tile planner           | Splits the image into overlap-safe tile descriptors               |
| CPU kernels            | Provide the deterministic fallback and parity reference           |
| Worker pool            | Runs transferable tile jobs off the browser main thread           |
| Zig WASM backend       | Executes the main tiled filter pipeline when selected             |
| WebGPU compute backend | Accelerates compatible processing in WebGPU runtimes              |
| AI mask provider       | Creates semantic alpha masks in browser apps                      |
| `TileSink`             | Writes processed tile output to storage or an encoder             |
| Renderer adapters      | Upload RGBA data to WebGPU or WebGL previews                      |

Compressed image streaming is intentionally outside the core. Implement
`TileSource.read(rect)` and `TileSink.write(rect, data)` to integrate a decoder
or encoder without coupling Phantom to one codec.

## Development

Requirements:

- Node.js 22 or later
- npm 10 or later
- Zig 0.16.0 for `npm test`, `npm run build:wasm`, and `npm run ci`

Install dependencies:

```bash
npm ci
```

Useful scripts:

| Command                 | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `npm test`              | Build Zig WASM and run Vitest, including WASM parity tests         |
| `npm run test:zig`      | Run native Zig kernel unit tests                                   |
| `npm run typecheck`     | Run TypeScript strict checks                                       |
| `npm run lint`          | Run ESLint                                                         |
| `npm run build`         | Emit TypeScript build artifacts to `dist/`                         |
| `npm run build:wasm`    | Compile `zig/src/phantom-kernel.zig` to `dist/phantom_kernel.wasm` |
| `npm run demo:build`    | Build the demo app to `demo-dist/`                                 |
| `npm run dev`           | Run the demo app locally                                           |
| `npm run ci`            | Run typecheck, lint, native Zig/WASM tests, and TypeScript build   |
| `npm run release:patch` | Bump package patch version                                         |
| `npm run release:minor` | Bump package minor version                                         |
| `npm run release:major` | Bump package major version                                         |

Full local verification:

```bash
npm run ci
npm run demo:build
npm pack --dry-run
```

Do not commit generated `dist/`, `demo-dist/`, model weights, caches, local
environment files, or Zig build output.

See [CONTRIBUTING.md](CONTRIBUTING.md) for pull-request rules and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Release Process

The repository publishes to npm through
[`.github/workflows/publish-npm.yml`](.github/workflows/publish-npm.yml). The
workflow runs on:

- Pushes to tags matching `v*.*.*`.
- Published GitHub Releases.
- Manual workflow dispatch with a release tag input.

Before the first npm release, configure:

1. An npm automation token with publish access.
2. A GitHub Actions secret named `NPM_TOKEN`.
3. A GitHub Environment named `npm`.
4. Access to the npm organization scope `@paramission-lab`.

GitHub organizations and npm organizations are separate. The publish workflow
expects `package.json` to use `@paramission-lab/phantom`; creating only the
GitHub organization is not enough.

Release checklist:

```bash
npm ci
npm run ci
npm run demo:build
npm pack --dry-run
npm version patch
git push origin main --follow-tags
```

Pushing a tag that matches `v<package.version>` starts the publish workflow. The
workflow checks out the tag, verifies the package name, verifies the tag equals
`v<package.version>`, runs full validation, builds the demo, performs
`npm pack --dry-run`, and publishes with npm provenance.

If publishing fails with `E404 Scope not found`, create the npm organization
`paramission-lab` on npmjs.com or change the package scope to one the token can
publish. Then create a new patch version and tag; do not move an already pushed
release tag.

## Operational Limits

- Phantom can process very large targets as bounded tiles, but this does not
  mean every browser, decoder, canvas, or GPU can allocate a full 32K/64K frame.
- Browser image conversion depends on host canvas encoder support.
- WebGPU support and precision vary by browser, GPU, and driver.
- `SharedArrayBuffer` in browsers requires cross-origin isolation headers.
- AI background-removal quality depends on model choice, input content, backend,
  and mask-refinement settings.
- For extreme-resolution AI cutouts, run inference on a bounded working image
  and apply/refine the resulting mask through tile-aware workflows instead of
  allocating a full-resolution neural-network tensor.

## Project Documents

- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [MIT license](LICENSE)

## License

[MIT](LICENSE)
