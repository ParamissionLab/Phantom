# Contributing to phantom

Contributions should preserve the SDK's bounded-memory design, deterministic CPU baseline, and stable package entry points.

## Development setup

Requirements:

- Node.js 22 or later
- npm 10 or later
- Zig 0.15.2 for the WebAssembly build

```bash
npm ci
npm run ci
npm run demo:build
```

Run the interactive demo with:

```bash
npm run dev
```

## Pull requests

1. Open a focused branch from `main`.
2. Keep reusable code in `src/` and demo-only presentation code in `demo/`.
3. Add or update Vitest coverage for observable behavior changes.
4. Run `npm run ci` and `npm run demo:build` before opening the pull request.
5. Update `README.md` for public API changes and add an entry under `CHANGELOG.md` > `Unreleased`.
6. Describe compatibility, memory, performance, and licensing effects in the pull request.

Release tags must use semantic versions such as `v1.0.1`. Consumers installing directly from GitHub should pin a release tag or full commit SHA.

Do not commit generated `dist/`, `demo-dist/`, model weights, caches, or local environment files.

## API and performance rules

- Do not remove or rename public exports without a major-version plan.
- Keep the core entry point free of DOM and machine-learning initialization.
- Process extreme-resolution data in bounded tiles; do not allocate a full 32K/64K RGBA frame in a kernel.
- Keep the TypeScript CPU implementation as the correctness reference for accelerated backends.
- Dispose AI pipelines and GPU resources explicitly.
- Document the license of every model or asset introduced by a contribution.

## Commit and changelog style

Use short imperative commit subjects. Changelog entries should explain user-visible behavior under `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, or `Performance`.
