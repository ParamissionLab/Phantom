# Contributing to phantom

Contributions should preserve the SDK's bounded-memory design, deterministic CPU baseline, and stable package entry points.

## Development Setup

Requirements:

- Node.js 22 or later
- npm 10 or later
- Zig 0.16.0 for the WebAssembly build

```bash
npm ci
```

Run the full local verification before opening a pull request:

```bash
npm run ci
npm run demo:build
npm pack --dry-run
```

Run the interactive demo:

```bash
npm run dev
```

## Repository Layout

| Path           | Purpose                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `src/core/`    | DOM-free raw RGBA, tiling, filters, masks, planning, and pipeline code |
| `src/ai/`      | Optional browser AI background-removal runtime                         |
| `src/gpu/`     | Browser capability detection and WebGPU/WebGL adapters                 |
| `src/workers/` | Browser worker pool and shared tile-buffer utilities                   |
| `src/wasm/`    | Zig WASM TypeScript adapter                                            |
| `zig/`         | Zig kernel source used by `npm run build:wasm`                         |
| `test/`        | Vitest coverage for public behavior and edge cases                     |
| `demo/`        | Browser demo app; keep demo-only UI code here                          |

## Pull Requests

1. Open a focused branch from `main`.
2. Keep reusable code in `src/` and demo-only presentation code in `demo/`.
3. Add or update Vitest coverage for observable behavior changes.
4. Run `npm run ci`, `npm run demo:build`, and `npm pack --dry-run`.
5. Update `README.md` for public API changes and add an entry under `CHANGELOG.md` > `Unreleased`.
6. Describe compatibility, memory, performance, and licensing effects in the pull request.

Release tags must use semantic versions in the `v<major>.<minor>.<patch>` format. Consumers installing directly from GitHub should pin a release tag or full commit SHA.

Do not commit generated `dist/`, `demo-dist/`, model weights, caches, or local environment files.

## API Rules

- Do not remove or rename public exports without a major-version plan.
- Keep `package.json` export paths in sync with source entry points.
- Keep the core entry point free of DOM and machine-learning initialization.
- Prefer subpath imports for optional browser-only code in examples.
- Keep root facade helpers small and predictable; advanced behavior belongs in the lower-level modules.

## Performance and Memory Rules

- Process extreme-resolution data in bounded tiles; do not allocate a full 32K/64K RGBA frame in a kernel.
- Keep the TypeScript CPU implementation as the correctness reference for accelerated backends.
- Keep browser worker entry points package-exported when they are required at runtime by `TileWorkerPool`.
- Dispose AI pipelines and GPU resources explicitly.
- Document the license of every model or asset introduced by a contribution.

## Testing Guidelines

- Put tests in `test/*.test.ts`.
- Test public behavior, validation errors, and edge cases rather than private implementation details.
- Use existing Vitest style and helpers before adding new test infrastructure.
- Cover new filters across CPU and any accelerated backend routing touched by the change.
- For browser-only code, keep tests focused on behavior that can run in the configured Vitest environment.

## Documentation Guidelines

- Keep README examples copy-pasteable and aligned with exported APIs.
- Mark browser-only features clearly when they require canvas, workers, WebGPU, or AI model downloads.
- Update `CHANGELOG.md` under `Unreleased` for user-visible changes.
- Do not document planned APIs as available until they are exported and tested.

## Commit and Changelog Style

Use short imperative commit subjects. Changelog entries should explain user-visible behavior under `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, or `Performance`.

## Release Notes

The publish workflow validates the package name, release tag, full CI, demo build, and npm package contents before publishing. Do not move published tags. If a release needs a fix, create a new patch version.
