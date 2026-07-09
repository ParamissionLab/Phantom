/**
 * Global WASM backend registry.
 *
 * Allows the Zig/WASM kernel to be registered once at application startup.
 * After that, every pipeline call (processRawImage, applyFilter, edit().filter(), …)
 * that has no explicit tileProcessor will automatically use the WASM backend —
 * without the caller needing to know about TileProcessor or WasmKernelBackend.
 *
 * Usage:
 *
 *   import phantom, { configureWasm } from "@paramission-lab/phantom";
 *
 *   await configureWasm("/assets/phantom_kernel.wasm");
 *   // From this point on, all phantom.applyFilter / edit().filter() calls
 *   // run through the Zig kernel automatically.
 *
 * The registry is process-global and intentionally simple — it holds at most
 * one active TileProcessor at a time, matching the "configure once, use everywhere"
 * pattern expected in app startup code.
 */

import type { TileProcessor } from "./types.js";

let activeProcessor: TileProcessor | null = null;

// Dedup concurrent configureWasm() calls: if two callers await configureWasm()
// at the same time, the second one reuses the first one's in-flight promise
// instead of starting a second WebAssembly.instantiate().
let pendingInit: Promise<void> | null = null;

/**
 * Returns the currently registered WASM/custom processor, or null if none
 * has been configured. The pipeline calls this to decide whether to use WASM
 * or fall back to the CPU baseline.
 */
export function getRegisteredProcessor(): TileProcessor | null {
  return activeProcessor;
}

/**
 * Registers a TileProcessor as the global default for all pipeline calls
 * that do not supply their own tileProcessor option.
 *
 * Pass null to revert to the CPU baseline.
 */
export function registerProcessor(processor: TileProcessor | null): void {
  activeProcessor = processor;
  // Clear any pending init so a fresh configureWasm() call after reset works.
  if (processor === null) {
    pendingInit = null;
  }
}

/**
 * Returns the pending init promise if a configureWasm() call is in-flight,
 * so the loader can dedup concurrent invocations.
 */
export function getPendingInit(): Promise<void> | null {
  return pendingInit;
}

/**
 * Stores the in-flight init promise for deduplication.
 */
export function setPendingInit(p: Promise<void> | null): void {
  pendingInit = p;
}

// ---------------------------------------------------------------------------
// Auto-resolver: locate phantom_kernel.wasm relative to THIS module
// ---------------------------------------------------------------------------

/**
 * Returns a `URL` that points to `phantom_kernel.wasm` sitting next to this
 * JS module — the same directory that bundlers (Vite, webpack, Rollup, esbuild)
 * emit the file into when you run `npm run build`.
 *
 * Works in:
 *   - Browsers served by any bundler (Vite / webpack / Rollup / esbuild)
 *   - Node.js ESM (Node ≥ 18)
 *   - Deno / Bun
 *   - Web Workers
 */
export function resolveKernelUrl(): URL | null {
  try {
    // Build the path via concatenation so that ALL bundlers (Vite, webpack,
    // Rollup, esbuild, Parcel …) skip static-asset analysis on this string.
    // Bundlers only recognize the `new URL("<literal>", import.meta.url)`
    // pattern when the first argument is a bare string literal; a "+" expression
    // is always treated as runtime-dynamic and left untouched — no bundler-
    //
    // `phantom_kernel.wasm` is emitted next to this JS file by the build
    // pipeline and resolved at runtime via `import.meta.url`.
    const wasmFile = "phantom_kernel" + ".wasm";
    return new URL("./" + wasmFile, import.meta.url);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cross-environment byte loader
// ---------------------------------------------------------------------------

/**
 * Loads raw bytes from a URL using `globalThis.fetch`.
 * Requires Node ≥ 18, any browser, Deno, or Bun.
 *
 * To supply bytes manually (e.g. from disk in a build script):
 *   import { readFile } from "node:fs/promises";
 *   await configureWasm(await readFile("/path/to/phantom_kernel.wasm"));
 */
export async function loadWasmBytes(
  source: string | URL,
): Promise<ArrayBuffer> {
  const url = source instanceof URL ? source.href : source;
  let response: Response;
  try {
    response = await globalThis.fetch(url);
  } catch (err: unknown) {
    throw new Error(
      `configureWasm: fetch("${url}") failed — ${String(err)}.\n` +
        `Pass an ArrayBuffer instead: await configureWasm(await readFile(path));`,
      { cause: err },
    );
  }
  if (!response.ok) {
    throw new Error(
      `configureWasm: fetch("${url}") returned HTTP ${response.status}.\n` +
        `Pass an ArrayBuffer instead: await configureWasm(await readFile(path));`,
    );
  }
  return response.arrayBuffer();
}
