import type { ProgressInfo, RawImage } from "@huggingface/transformers";
import {
  applyAlphaMask,
  type AlphaMask,
  type AlphaMaskRefinementOptions,
  type AlphaMaskResult,
} from "../core/background.js";
import { PhantomError, type RawRgbaImage } from "../core/types.js";

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

export interface AiBackgroundRemovalOptions
  extends AiBackgroundRemoverOptions, AlphaMaskRefinementOptions {
  /**
   * Demo-style foreground cutoff. When `threshold` is not set, this maps to the
   * alpha-mask threshold used internally by the SDK.
   */
  readonly maskCutoff?: number;
  /** Demo-style subject guard percentage used to tune edge sensitivity. */
  readonly subjectGuard?: number;
  readonly onProgress?: (progress: AiProgress) => void;
}

export interface AiBackgroundRemovalResult extends AlphaMaskResult {
  readonly alphaMask: AlphaMask;
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

export const AI_BACKGROUND_DEFAULTS = {
  maskCutoff: 38,
  softness: 54,
  featherRadius: 2,
  subjectGuard: 70,
} as const;

const MASK_CUTOFF_THRESHOLD_OFFSET = 32;
const EDGE_SENSITIVITY_BASE = 34;
const EDGE_SENSITIVITY_GUARD_SCALE = 0.35;

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

export function createAiRemover(
  options: AiBackgroundRemoverOptions = {},
): BrowserBackgroundRemover {
  return new BrowserBackgroundRemover(options);
}

/**
 * Normalizes AI background-removal controls to the alpha-mask refinement options
 * used by `aiRemoveBackground()`. Defaults match the demo's tuned controls.
 */
export function normalizeAiMaskOptions(
  options: AiBackgroundRemovalOptions = {},
): AlphaMaskRefinementOptions {
  const maskCutoff =
    options.maskCutoff ?? AI_BACKGROUND_DEFAULTS.maskCutoff;
  const subjectGuard =
    options.subjectGuard ?? AI_BACKGROUND_DEFAULTS.subjectGuard;

  if (
    !Number.isFinite(maskCutoff) ||
    maskCutoff < 0 ||
    maskCutoff > 255 ||
    !Number.isFinite(subjectGuard) ||
    subjectGuard < 0 ||
    subjectGuard > 100
  ) {
    throw new PhantomError(
      "maskCutoff must be from 0 to 255 and subjectGuard must be from 0 to 100.",
    );
  }

  return {
    threshold:
      options.threshold ??
      Math.max(0, maskCutoff - MASK_CUTOFF_THRESHOLD_OFFSET),
    softness: options.softness ?? AI_BACKGROUND_DEFAULTS.softness,
    featherRadius:
      options.featherRadius ?? AI_BACKGROUND_DEFAULTS.featherRadius,
    edgeSensitivity:
      options.edgeSensitivity ??
      EDGE_SENSITIVITY_BASE + subjectGuard * EDGE_SENSITIVITY_GUARD_SCALE,
  };
}

/**
 * One-call AI background removal for browser apps.
 */
export async function aiRemoveBackground(
  image: BrowserImageInput,
  options: AiBackgroundRemovalOptions = {},
): Promise<AiBackgroundRemovalResult> {
  const prepared = await prepareBrowserImage(image);
  const remover = createAiRemover(options);

  try {
    const { mask, backend, model } = await remover.createMask(
      prepared.modelInput,
      options.onProgress,
    );
    const cutout = applyAlphaMask(
      prepared.rgba,
      mask,
      normalizeAiMaskOptions(options),
    );

    return {
      ...cutout,
      alphaMask: mask,
      backend,
      model,
    };
  } finally {
    prepared.close?.();
    await remover.dispose();
  }
}

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

async function prepareBrowserImage(image: BrowserImageInput): Promise<{
  readonly rgba: RawRgbaImage;
  readonly modelInput: BrowserImageInput;
  readonly close?: () => void;
}> {
  if (isCanvas(image)) {
    return { rgba: readCanvasRgba(image), modelInput: image };
  }

  const blob = await loadImageBlob(image);
  const bitmap = await createImageBitmap(blob);
  const canvas = drawBitmapToCanvas(bitmap);

  return {
    rgba: readCanvasRgba(canvas),
    modelInput: canvas,
    close: () => {
      bitmap.close();
    },
  };
}

async function loadImageBlob(image: BrowserImageInput): Promise<Blob> {
  if (image instanceof Blob) {
    return image;
  }

  if (typeof image === "string" || image instanceof URL) {
    if (typeof fetch === "undefined") {
      throw new PhantomError("fetch is required to load image URLs.");
    }
    const response = await fetch(image);
    if (!response.ok) {
      throw new PhantomError(`Unable to load image: HTTP ${response.status}.`);
    }
    return response.blob();
  }

  throw new PhantomError("Unsupported AI image input.");
}

function drawBitmapToCanvas(
  bitmap: ImageBitmap,
): HTMLCanvasElement | OffscreenCanvas {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new PhantomError("Unable to create a 2D canvas context.");
  }
  context.drawImage(bitmap, 0, 0);
  return canvas;
}

function readCanvasRgba(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): RawRgbaImage {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    throw new PhantomError("Unable to read a 2D canvas context.");
  }
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8Array(imageData.data),
  };
}

function createCanvas(
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  throw new PhantomError("Canvas APIs are required for AI background removal.");
}

function isCanvas(
  value: BrowserImageInput,
): value is HTMLCanvasElement | OffscreenCanvas {
  return (
    (typeof HTMLCanvasElement !== "undefined" &&
      value instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas)
  );
}
