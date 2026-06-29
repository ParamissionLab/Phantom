export type ComputeBackend = "webgpu" | "wasm-simd" | "cpu";

export interface CapabilityReport {
  readonly backend: ComputeBackend;
  readonly webgpu: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly crossOriginIsolated: boolean;
  readonly hardwareConcurrency: number;
}

/**
 * Detects browser capabilities without throwing in older runtimes.
 */
export function detectCapabilities(
  globalScope: typeof globalThis = globalThis,
): CapabilityReport {
  const nav = globalScope.navigator;
  const webgpu = nav !== undefined && "gpu" in nav;
  const sharedArrayBuffer =
    typeof globalScope.SharedArrayBuffer !== "undefined";
  const isolated = globalScope.crossOriginIsolated === true;
  const hardwareConcurrency = nav?.hardwareConcurrency ?? 1;

  return {
    backend: webgpu
      ? "webgpu"
      : sharedArrayBuffer && isolated
        ? "wasm-simd"
        : "cpu",
    webgpu,
    sharedArrayBuffer,
    crossOriginIsolated: isolated,
    hardwareConcurrency,
  };
}
