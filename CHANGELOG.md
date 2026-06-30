# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/ParamissionLab/phantom/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/ParamissionLab/phantom/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ParamissionLab/phantom/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/ParamissionLab/phantom/releases/tag/v0.1.0
