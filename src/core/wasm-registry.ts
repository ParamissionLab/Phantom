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
// Cross-environment byte loader
// ---------------------------------------------------------------------------

/**
 * Loads raw bytes from a path/URL using whatever runtime API is available.
 *
 * Resolution order:
 *   1. `globalThis.fetch`               — browsers, Node ≥ 18, Deno, Bun
 *   2. `node:fs/promises.readFile`      — Node < 18 (ESM dynamic import)
 *   3. Synchronous `require("fs")`      — Node < 18 (CJS fallback)
 *
 * If none of those are available the function throws a descriptive error that
 * tells the caller exactly how to provide the bytes themselves instead.
 */
export async function loadWasmBytes(source: string | URL): Promise<ArrayBuffer> {
  // ── 1. fetch (browsers + Node ≥ 18 + Deno + Bun + React Native with fetch polyfill) ──
  if (typeof globalThis.fetch === "function") {
    const url = source instanceof URL ? source.href : source;
    let response: Response;
    try {
      response = await globalThis.fetch(url);
    } catch (err: unknown) {
      throw new Error(
        `configureWasm: fetch("${url}") failed — ${String(err)}.\n` +
        `Pass an ArrayBuffer instead: await configureWasm(await fs.readFile(path));`,
        { cause: err },
      );
    }
    if (!response.ok) {
      throw new Error(
        `configureWasm: fetch("${url}") returned HTTP ${response.status}.\n` +
        `Pass an ArrayBuffer instead: await configureWasm(await fs.readFile(path));`,
      );
    }
    return response.arrayBuffer();
  }

  // ── 2. Node < 18 ESM: dynamic import of node:fs/promises ──
  const pathStr = source instanceof URL ? source.pathname : source;

  if (typeof process !== "undefined" && typeof process.versions?.node === "string") {
    // Try ESM-style dynamic import first (works in Node 12+ with --experimental-vm-modules)
    try {
      const fsPromises = (await import("node:fs/promises")) as {
        readFile: (this: void, path: string) => Promise<Buffer>;
      };
      const buf = await fsPromises.readFile(pathStr);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    } catch {
      // Fall through to synchronous fs for very old Node
    }

    // ── 3. Node synchronous fallback (Node < 12 or bundler limitation) ──
    try {
      const fsSync = (await import("fs")) as {
        readFileSync: (this: void, path: string) => Buffer;
      };
      const buf = fsSync.readFileSync(pathStr);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    } catch {
      // Fall through to descriptive error
    }
  }

  // ── No loader found — tell the user exactly what to do ──
  throw new Error(
    `configureWasm: cannot load "${String(source)}" automatically in this environment.\n\n` +
    `Read the file yourself and pass the bytes directly:\n\n` +
    `  // Node.js\n` +
    `  import { readFile } from "node:fs/promises";\n` +
    `  await configureWasm(await readFile("/path/to/phantom_kernel.wasm"));\n\n` +
    `  // React Native (react-native-fs)\n` +
    `  import RNFS from "react-native-fs";\n` +
    `  const b64 = await RNFS.readFile(path, "base64");\n` +
    `  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;\n` +
    `  await configureWasm(bytes);\n\n` +
    `  // Any environment\n` +
    `  const bytes = await myCustomLoader(path);\n` +
    `  await configureWasm(bytes);`,
  );
}
