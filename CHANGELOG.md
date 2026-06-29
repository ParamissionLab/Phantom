# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-06-29

This release consolidates all previous and unreleased notes into one complete
description of Phantom's current public feature set.

### Added

- Tile-first RGBA processing with bounded-memory planning for 16K, 32K, and
  64K workflows.
- Fixed-capacity stream ingestion, overlap-safe tile planning, raw tile
  sources/sinks, transferable worker jobs, a worker pool, and shared tile
  buffers.
- Fixed-point CPU filters for identity, invert, grayscale, natural enhancement,
  and 3x3 sharpening with discoverable filter profiles.
- High-level `phantom` facade and named helpers for image creation, cropping,
  resizing, single or multi-filter processing, masks, and background flattening.
- Raw RGBA allocation, defensive cloning, cropping, nearest-neighbor resizing,
  and bilinear resizing.
- Processing pipelines, progress callbacks, runtime statistics, memory planning,
  and automatic safe overlap selection.
- Provider-neutral alpha-mask resizing, color-guided refinement, compositing,
  and background replacement.
- Stable shared AI refinement defaults for threshold, softness, feather radius,
  and edge sensitivity.
- `@paramission-lab/phantom/ai` with lazy model loading, WebGPU acceleration,
  CPU/WASM fallback, browser caching, progress reporting, shared initialization,
  reusable inference, and explicit resource disposal.
- One-call `removeBackgroundAi()`, reusable `createAiBackgroundRemover()`, and
  the short `createPhantomAi()` alias.
- `@paramission-lab/phantom/browser` with PNG, JPEG, and WebP conversion for
  Blob, URL, Canvas, ImageData, and raw RGBA inputs.
- Phantom Adaptive Export, which selects a format from sampled alpha, color
  complexity, and edge density and reports its decision.
- Safe PNG fallback when a requested browser encoder is unavailable.
- WebGPU compute processing, WebGPU/WebGL renderers, Zig WebAssembly kernels,
  and the `@paramission-lab/phantom/wasm` adapter.
- Upload-based Tailwind CSS Demo with before/after comparison, AI removal,
  adaptive export, runtime capabilities, memory planning, filter profiles, and
  the complete SDK feature surface.
- GitHub organization documentation, contribution guidance, security policy,
  strict TypeScript, ESLint, Prettier, Vitest, and npm package exports.

### Changed

- Standardized the SDK brand as `phantom` and the npm package as
  `@paramission-lab/phantom` because the unscoped package name is occupied.
- Renamed the public SDK error to `PhantomError` and standardized validation and
  backend failures around it.
- Isolated the Demo under `demo/`, browser codecs under `src/browser/`, and the
  optional AI runtime under `src/ai/` so the core remains DOM-neutral.
- Starts one-call AI model initialization in parallel with image loading and
  decoding to reduce cold-start latency.
- Preloads the AI model when the Demo starts and reuses one model and semantic
  mask while refinement controls are adjusted.
- Centralized AI alpha-mask defaults so one-call removal and the Demo cannot
  drift to different presets.
- Kept advanced tile, source/sink, mask, GPU, worker, WASM, and batch AI APIs
  available alongside the short default facade.

### Removed

- Removed the deterministic fuzzy background remover, its public exports,
  facade helper, Demo controls, and tests. Background removal now uses the
  downloaded AI model only.

### Fixed

- Rejects filter overlap smaller than the kernel radius to prevent tile seams.
- Handles both array and direct `RawImage` outputs from Transformers.js.
- Correctly selects Transformers.js 4.x WebGPU or CPU/WASM configuration and
  environment-specific browser caching.
- Preserves existing source transparency when applying generated alpha masks.
- Cleans `dist` before builds so removed modules cannot leak into npm tarballs
  as stale artifacts.
- Requires release tags to match `package.version` and verifies the corrected
  `@paramission-lab/phantom` scope before publishing.

### Performance

- Shares concurrent AI preload and inference initialization promises.
- Loads the AI model in parallel with image decoding and caches pipelines and
  per-image semantic masks.
- Keeps AI code split from the core package until the AI entry point is used.
- Uses bounded tile planning, unrolled packed Zig filter loops, reused 3x3
  neighbor indexes, and native Zig alpha-mask compositing.

### CI/CD

- Supports reproducible GitHub URL installation through the npm `prepare`
  lifecycle.
- Runs type checking, linting, tests, TypeScript and Zig WASM builds, Demo
  builds, and npm tarball validation before publishing.
- Publishes release tags to npm with provenance and validates that each tag
  equals `v<package.version>`.

[Unreleased]: https://github.com/ParamissionLab/phantom/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/ParamissionLab/phantom/releases/tag/v1.0.1
