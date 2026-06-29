import type { ProgressInfo, RawImage } from "@huggingface/transformers";
import type { AlphaMask } from "../core/background.js";

const DEFAULT_MODEL_ID = "onnx-community/ormbg-ONNX";

export type AiBackend = "webgpu" | "wasm";
export type AiBackendPreference = "auto" | AiBackend;
export type BrowserImageInput =
  string | URL | Blob | HTMLCanvasElement | OffscreenCanvas;

export interface AiBackgroundRemoverOptions {
  readonly model?: string;
  readonly backend?: AiBackendPreference;
  readonly webgpuDtype?: "fp16" | "fp32";
  readonly wasmDtype?: "q4" | "q8" | "fp32";
}

export interface AiProgress {
  readonly label: string;
  readonly percent?: number;
}

export interface AiMaskResult {
  readonly mask: AlphaMask;
  readonly backend: AiBackend;
  readonly model: string;
}

export interface AiPreloadResult {
  readonly backend: AiBackend;
  readonly model: string;
}

interface SemanticPipeline {
  (image: BrowserImageInput): Promise<RawImage | RawImage[]>;
  dispose(): Promise<void>;
}

interface LoadedEngine {
  readonly pipeline: SemanticPipeline;
  readonly backend: AiBackend;
}

/** Browser AI engine that lazily loads, caches, and reuses one segmentation model. */
export class BrowserBackgroundRemover {
  private enginePromise: Promise<LoadedEngine> | undefined;
  private engine: LoadedEngine | undefined;
  private readonly model: string;
  private readonly backend: AiBackendPreference;
  private readonly webgpuDtype: "fp16" | "fp32";
  private readonly wasmDtype: "q4" | "q8" | "fp32";

  public constructor(options: AiBackgroundRemoverOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL_ID;
    this.backend = options.backend ?? "auto";
    this.webgpuDtype = options.webgpuDtype ?? "fp16";
    this.wasmDtype = options.wasmDtype ?? "q8";
  }

  public async createMask(
    image: BrowserImageInput,
    onProgress?: (progress: AiProgress) => void,
  ): Promise<AiMaskResult> {
    const engine = await this.getEngine(onProgress);
    onProgress?.({
      label: `Running ${engine.backend.toUpperCase()} inference`,
    });
    const outputs = await engine.pipeline(image);
    const output = Array.isArray(outputs) ? outputs[0] : outputs;

    if (
      output === undefined ||
      (output.channels !== 1 && output.channels < 4)
    ) {
      throw new Error("The AI background model returned an unsupported mask.");
    }

    const alpha = new Uint8Array(output.width * output.height);
    for (let pixel = 0; pixel < alpha.length; pixel += 1) {
      const channel = output.channels === 1 ? 0 : 3;
      alpha[pixel] = output.data[pixel * output.channels + channel] ?? 0;
    }

    return {
      mask: { width: output.width, height: output.height, data: alpha },
      backend: engine.backend,
      model: this.model,
    };
  }

  /**
   * Downloads and initializes the configured model without running inference.
   * Concurrent preload and createMask calls share the same initialization.
   */
  public async preload(
    onProgress?: (progress: AiProgress) => void,
  ): Promise<AiPreloadResult> {
    const engine = await this.getEngine(onProgress);
    return { backend: engine.backend, model: this.model };
  }

  public async dispose(): Promise<void> {
    const pendingEngine = this.enginePromise;
    const engine = this.engine ?? (await pendingEngine?.catch(() => undefined));
    this.engine = undefined;
    this.enginePromise = undefined;
    await engine?.pipeline.dispose();
  }

  private async getEngine(
    onProgress?: (progress: AiProgress) => void,
  ): Promise<LoadedEngine> {
    if (this.engine !== undefined) {
      return this.engine;
    }
    this.enginePromise ??= this.loadEngine(onProgress).catch(
      (error: unknown) => {
        this.enginePromise = undefined;
        throw error;
      },
    );
    this.engine = await this.enginePromise;
    return this.engine;
  }

  private async loadEngine(
    onProgress?: (progress: AiProgress) => void,
  ): Promise<LoadedEngine> {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    env.useBrowserCache = typeof caches !== "undefined";

    const progressCallback = createProgressCallback(onProgress);
    const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
    if (this.backend !== "wasm" && hasWebGpu) {
      try {
        onProgress?.({ label: "Starting WebGPU model" });
        return {
          pipeline: await createPipeline(
            pipeline,
            this.model,
            "webgpu",
            this.webgpuDtype,
            progressCallback,
          ),
          backend: "webgpu",
        };
      } catch (error: unknown) {
        if (this.backend === "webgpu") {
          throw error;
        }
        onProgress?.({ label: "WebGPU unavailable, switching to WASM" });
      }
    }

    return {
      pipeline: await createPipeline(
        pipeline,
        this.model,
        "cpu",
        this.wasmDtype,
        progressCallback,
      ),
      backend: "wasm",
    };
  }
}

export function createAiBackgroundRemover(
  options: AiBackgroundRemoverOptions = {},
): BrowserBackgroundRemover {
  return new BrowserBackgroundRemover(options);
}

/** Short branded alias for createAiBackgroundRemover. */
export const createPhantomAi = createAiBackgroundRemover;

function createProgressCallback(
  onProgress?: (progress: AiProgress) => void,
): (info: ProgressInfo) => void {
  return (info: ProgressInfo): void => {
    if (info.status === "progress") {
      onProgress?.({
        label: `Loading ${shortFileName(info.file)}`,
        percent: info.progress,
      });
    } else if (info.status === "ready") {
      onProgress?.({ label: "AI model ready", percent: 100 });
    }
  };
}

async function createPipeline(
  factory: typeof import("@huggingface/transformers").pipeline,
  model: string,
  device: "webgpu" | "cpu",
  dtype: "fp16" | "fp32" | "q4" | "q8",
  progressCallback: (info: ProgressInfo) => void,
): Promise<SemanticPipeline> {
  const instance = await factory("background-removal", model, {
    device,
    dtype,
    progress_callback: progressCallback,
  });
  return instance;
}

function shortFileName(file: string): string {
  return file.split("/").at(-1) ?? "model";
}
