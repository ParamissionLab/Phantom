# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2026-07-08

### Added

- Added `createImage()` as a clearer named alternative to `makeImage()`.
- Added `createAssetPlan()` and `getProcessingPlan()` as descriptive named
  alternatives to `createPhantomAssetPlan()` and `describeProcessingPlan()`.
- Added `aiRemoveBackground()` and `createAiRemover()` as shorter aliases for
  `removeBackgroundAi()` and `createPhantomAi()`.
- Added `fillTransparentWith()` and `featherAlphaMask()` as clearer alternative
  names for `replaceTransparentBackground()` and `refineAlphaMask()`.
- Added `normalizeAiMaskOptions()` as the clearer name for
  `resolveAiMaskRefinementOptions()`.
- Added `suggestAutoAdjust()` and `autoAdjustImage()` as clearer names for
  `autoLevelSuggestion()` and `autoLevelImage()`.
- Added `pipeChunksToBuffer()` as the clearer name for
  `streamChunksToFixedBuffer()`.
- Added `instantiateWasmBackend()` and `createWasmTileProcessor()` as the portable
  names for `instantiateZigBackend()` and `createZigTileProcessor()`.
- Added `useWasm()` convenience wrapper that auto-resolves the WASM kernel URL
  via `import.meta.url`.
- Added `resolveKernelUrl()` to `wasm-registry.ts` for external callers that need
  to locate `phantom_kernel.wasm`.

### Changed

- Removed old `Phantom`-branded aliases (`createPhantomAssetPlan`, `planAsset`,
  `makeImage`, `processImage`, `describeProcessingPlan`, `autoLevelImage`,
  `autoLevelSuggestion`, `replaceTransparentBackground`, `refineAlphaMask`,
  `streamChunksToFixedBuffer`, `instantiateZigBackend`, `createZigTileProcessor`,
  `createPhantomAi`, `removeBackgroundAi`, `resolveAiMaskRefinementOptions`,
  `PHANTOM_AI_BACKGROUND_DEFAULTS`, `phantom.process`). Use the shorter portable
  names listed in the "Added" section instead.
- Renamed `AI_BACKGROUND_DEFAULTS` constant from `PHANTOM_AI_BACKGROUND_DEFAULTS`.
- `resolveKernelUrl()` returns a `URL | null` and is safe to call in any JS
  environment.
- Updated `package.json` version to `1.0.3`.

## [1.0.2] - 2026-07-04

### Added

- Added the pluggable `TileProcessor` contract so callers can route planned
  tile work through CPU, Zig WASM, worker, GPU, or native backends.
- Added `createZigTileProcessor()` to adapt an instantiated Zig WASM backend to
  the shared tile-processing pipeline.
- Added demo feature-lab coverage for image helpers, facade pipelines,
  low-level tile processing, custom processors, masks, codecs, planning,
  buffers, fixed-point utilities, and runtime capability checks.
- Added `TileBufferPool` for zero-allocation tile processing — a size-bucketed
  buffer pool that recycles Uint8Array buffers across tiles to eliminate GC
  pressure on large images.
- Added automated benchmark suite (`test/bench/kernel-benchmark.ts`) covering
  all CPU kernels, pipeline single/multi-step, resize operations, and large
  image throughput. Run with `npm run bench`.
- Added `bench` script to `package.json` for one-command performance testing.
- Benchmark suite auto-reports untestable features (WebGPU, Workers, WASM,
  WebGL) with explanations of why they require a browser environment.

### Changed

- Updated Zig WASM development and release workflows to Zig 0.16.0.
- Exposed custom tile processors through high-level filtering helpers so
  `applyFilter()`, `applyFilters()`, and edit pipelines can use alternate
  backends without dropping to lower-level APIs.
- Made the demo layout more compact with bounded preview, stat, and right-panel
  heights.

### Fixed

- Validated tile-source byte lengths before custom processors run, preventing
  malformed sources from surfacing as backend-specific failures or corrupted
  output.
- Ensured custom tile processor results validate returned descriptors and output
  byte lengths before sink writes.
- **Fixed color corruption in box blur** — separable 2-pass implementation was
  storing horizontal pixel sums (0–765) in `Uint8Array` causing overflow and
  RGB channel corruption on all processed images. Changed to `Uint16Array` for
  the intermediate buffer.

### Performance

- **CPU kernels: 8-15x throughput improvement** across all filters through:
  - Eliminated `forEachOutputPixel` callback overhead — all kernels now use
    inlined loops with zero function calls per pixel.
  - Precomputed row strides and clamped indices outside inner loops —
    convolution kernels now perform 1 bounds-check per row/column instead of
    9 per pixel.
  - Uint32Array XOR fast-path for invert — inverts RGB in one 32-bit operation
    per pixel while preserving alpha (8-wide unrolled loop).
  - Contiguous-region single memcpy for identity filter — detects when output
    is a contiguous slice of input and uses a single `set()` call.
  - Channel-unrolled convolution — eliminates the `for ch` loop, writing R/G/B
    as 3 independent accumulators for better JIT optimization.
  - Kernel coefficients extracted to local variables — avoids array indexing
    overhead in convolution inner loops.
  - Separable 2-pass box blur — reduces complexity from 9 samples/pixel to
    6 adds/pixel with integer multiply-shift for division by 9.
  - Uint32Array packed write for grayscale — 1 write per pixel instead of 4.
  - Bitwise shift `>> 3` replaces floating-point division in smoothEnhance and
    unsharpMask detail computation.
- **Pipeline throughput: 2-3x improvement** through:
  - Synchronous fast-path for CPU tile processing — bypasses all Promise and
    async machinery when using the default `cpuTileProcessor`.
  - Integrated `TileBufferPool` — reuses a single source buffer across all
    tiles instead of allocating per-tile.
  - Inlined tile read/write — eliminates `TileSource`/`TileSink` abstraction
    overhead in the synchronous path.
  - Double-buffer ping-pong for multi-step pipelines — only 2 image buffers
    allocated regardless of how many filter steps are applied.
- **Image resize: 4-6x improvement** through:
  - Separable 2-pass bilinear — splits 2D interpolation into horizontal then
    vertical passes, halving per-pixel sample count.
  - Precomputed X lookup table for nearest-neighbor with Uint32Array single-op
    pixel copy when memory is aligned.
  - Fixed-point 8-bit interpolation coefficients — eliminates all floating-point
    from inner loops.
- **Image allocation: 4x faster solid-color fill** using `Uint32Array.fill`
  with packed RGBA pixel instead of per-pixel byte writes.
- **Ring buffer: 3-5x throughput improvement** — power-of-two capacity with
  bitwise AND masking replaces modulo, max 2 bulk copies per operation,
  pre-allocated drain buffer in stream helper.
- **WASM backend: eliminated `heap.slice()` overhead** — uses direct
  `Uint8Array` view + `set()` for output extraction instead of intermediate
  `ArrayBuffer` allocation.

## [1.0.1] - 2026-06-30

### Added

- Added browser image format helpers for popular PNG, JPEG, WebP, AVIF, BMP,
  GIF, and TIFF identification.
- Added `convertImageFile()`, `optimizeImageFile()`, and `encodeRawImage()` for
  browser encoder based conversion and clarity-preserving re-encoding.
- Added `createPhantomAssetPlan()` and the default facade `planAsset()` helper
  for Phantom-specific format, filter, tile, and memory recommendations.
- Added `boxBlur3x3` and `unsharpMask` filters across CPU, worker, WebGPU, and
  Zig WASM routing.
- Added the short `@paramission-lab/phantom/worker` package export and retained
  `@paramission-lab/phantom/workers/tile-worker` as the long-form alias so
  browser bundlers can resolve the worker module used by `TileWorkerPool`.
- Added `phantom.edit()`, `phantom.process()`, `editImage()`, and
  `processImage()` as beginner-friendly pipeline APIs for chaining common image
  operations from one import.

### Changed

- Removed the deterministic fuzzy background-removal API from the public core
  package. Background removal now uses the downloaded AI model path plus
  provider-neutral alpha-mask utilities.
- Updated the default `phantom` facade to expose `applyMask`,
  `replaceBackground`, `planAsset`, `convertImage`, and `optimizeImage`.
- Renamed the Zig source entry point to `zig/src/phantom-kernel.zig`.
- Excluded Zig source files from the npm package `files` list so installs do not
  include the development `zig/` tree in `node_modules`.
- Updated installation examples, worker usage guidance, and package entry-point
  documentation to match the current public API.
- Added README guidance for choosing between Phantom's high-level pipeline and
  lower-level APIs.

### Fixed

- Updated demo and documentation to remove the old fuzzy fallback path.
- Isolated `TileWorkerPool` worker failures so one failed worker rejects only
  its assigned tile instead of rejecting unrelated in-flight tasks.
- Avoided direct `navigator` global access when selecting the default worker
  concurrency.

## [1.0.0] - 2026-06-29

### Added

- Added the default `phantom` facade and default package export for the common API:
  `makeImage`, `cropImage`, `resizeImage`, `applyFilter`, `applyFilters`,
  `removeImageBackground`, `applyMask`, and `replaceBackground`.
- Added short named helpers for common raw RGBA workflows so callers can avoid
  lower-level tile and overlap configuration in basic usage.
- Added raw RGBA image utilities for allocation, defensive cloning, cropping,
  and nearest-neighbor or bilinear resizing.
- Added `processRawImageWithStats()` and `processTileSourceWithStats()` for
  progress UIs, logging, and runtime health checks.
- Added `processRawImagePipeline()` for applying multiple filters as a reusable
  processing recipe.
- Added `removeBackgroundAi()` and the default `@paramission-lab/phantom/ai`
  facade so browser AI background removal can run in one call.

### Changed

- Made safe filter overlap selection the default path for the high-level
  filtering helpers.
- Updated README examples to start with the default `phantom` import and a
  shorter AI background-removal flow.
- Kept lower-level APIs available for advanced tile, source/sink, mask, and
  batch AI workflows.

### Fixed

- Standardized unsupported filter failures as `PhantomError`.
- Rejects too-small filter overlap before processing to prevent tile-edge
  artifacts.
- Prevented npm publishing from checking out the obsolete
  `@paramissionlab/phantom` package metadata by requiring a new tag whose name
  matches the package version and whose package name uses `@paramission-lab`.

## [0.1.0] - 2026-06-29

### Added

- GitHub organization documentation, contribution guidance, and a security policy.
- Direct GitHub URL installation through an npm `prepare` build lifecycle.
- GitHub Actions npm publish workflow for release-driven npmjs.com deployment.
- Public AI `preload()` API with shared concurrent model initialization.
- Short `createPhantomAi()` alias for concise branded SDK calls.
- Tile-first RGBA processing with bounded-memory planning for 16K, 32K, and 64K workflows.
- Fixed-point CPU filters for identity, invert, grayscale, natural enhancement, and 3x3 sharpening.
- Overlap-aware tile planning that prevents convolution seams.
- Fixed-capacity stream ingestion, transferable worker payloads, a worker pool, and shared tile buffers.
- WebGPU compute processing plus WebGPU and WebGL rendering adapters.
- Zig WebAssembly kernels and the `@paramission-lab/phantom/wasm` adapter.
- Fuzzy edge-connected background removal with multi-color border sampling, subject protection, and feathering.
- Provider-neutral alpha-mask resizing, color-guided refinement, compositing, and background replacement.
- Optional `@paramission-lab/phantom/ai` entry point with lazy model loading, WebGPU acceleration, CPU/WASM fallback, browser caching, progress reporting, and explicit resource disposal.
- Upload-based Tailwind CSS demo with before/after comparison, transparent PNG export, runtime capabilities, memory planning, and SDK feature controls.
- Strict TypeScript, ESLint, Prettier, Vitest, GitHub Actions CI, and npm package exports.

### Changed

- Added Paramission Lab repository, issue tracker, homepage, and package metadata.
- Standardized the SDK brand as `phantom` and the npm package name as `@paramission-lab/phantom`.
- Switched the npm package to the Paramission Lab scope because the unscoped `phantom` name is already occupied on npm.
- Renamed the public SDK error class to `PhantomError` so exported API names no longer carry the old image-specific branding.
- Established the public package and SDK surface as `phantom`.
- Isolated the demo under `demo/`; reusable implementation remains under `src/`.

### CI/CD

- CI builds the demo and validates the package tarball with `npm pack --dry-run`.
- Release publishing runs full verification before `npm publish --access public --provenance`.

### Fixed

- Prevented global color matching from deleting isolated foreground highlights.
- Added compatibility for both array and direct `RawImage` outputs from Transformers.js background-removal pipelines.
- Corrected Transformers.js 4.x CPU/WASM fallback and environment-specific cache selection.
- Preserved existing source transparency when applying generated alpha masks.

### Performance

- Demo AI model warm-up runs in parallel with image decoding and reuses the same pipeline promise for inference.
- Cached AI pipelines and per-image semantic masks to avoid repeated downloads and inference while tuning edges.
- Added lazy AI code splitting so importing the core SDK does not initialize the ML runtime.
- Unrolled packed Zig invert and grayscale loops and reused 3x3 neighbor indexes in enhancement kernels.
- Added native Zig alpha-mask compositing.

[Unreleased]: https://github.com/ParamissionLab/phantom/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/ParamissionLab/phantom/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/ParamissionLab/phantom/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/ParamissionLab/phantom/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ParamissionLab/phantom/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/ParamissionLab/phantom/releases/tag/v0.1.0
