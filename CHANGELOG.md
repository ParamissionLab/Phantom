# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/ParamissionLab/phantom/releases/tag/v0.1.0
