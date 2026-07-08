import {
  applyAlphaMask,
  applyFilterToTile,
  applyFilter,
  applyFilters,
  applyMask,
  canEncodeImageFormat,
  chooseTileSize,
  cloneRawImage,
  clampU8,
  configureWasm,
  convertImage,
  cpuTileProcessor,
  createPhantomAssetPlan,
  createRawRgbaImage,
  createRawTileSink,
  createRawTileSource,
  cropImage,
  describeProcessingPlan,
  detectCapabilities,
  encodeRawImage,
  FixedByteRingBuffer,
  FIXED_ONE,
  fromFixed,
  getImageFormatProfile,
  getPixelFilterOverlap,
  getRegisteredProcessor,
  isWasmReady,
  listPixelFilters,
  listImageFormats,
  makeImage,
  multiplyFixed,
  normalizeImageFormat,
  optimizeImage,
  phantom,
  planAsset,
  planTiles,
  processImage,
  processRawImage,
  processRawImagePipeline,
  processRawImageWithStats,
  processTileSource,
  RGBA_CHANNELS,
  resizeImage,
  SharedTileBuffer,
  streamChunksToFixedBuffer,
  toFixed,
  type PixelFilter,
  type AlphaMask,
  type RawRgbaImage,
  type Rect,
  type TileDescriptor,
  type TileProcessor,
} from "../../src/index.js";
import {
  createPhantomAi,
  resolveAiMaskRefinementOptions,
  type AiBackend,
  type AiProgress,
} from "../../src/ai/index.js";
import "./styles.css";

type ResolutionKey = "16k" | "32k" | "64k";
type OperationMode = "enhance" | "removeBackground";

interface DemoState {
  resolution: ResolutionKey;
  operation: OperationMode;
  filter: PixelFilter;
  backgroundThreshold: number;
  backgroundSoftness: number;
  backgroundFeather: number;
  foregroundGuard: number;
  memoryMb: number;
  slider: number;
  runningToken: number;
}

const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = 600;
const PREVIEW_TILE_SIZE = 128;
const FRAME_BUDGET_MS = 6;

const resolutions: Record<
  ResolutionKey,
  { width: number; height: number; label: string }
> = {
  "16k": { width: 16384, height: 9216, label: "16K canvas" },
  "32k": { width: 32768, height: 18432, label: "32K pro print" },
  "64k": { width: 65536, height: 32768, label: "64K wall scan" },
};

const state: DemoState = {
  resolution: "32k",
  operation: "enhance",
  filter: "smoothEnhance",
  backgroundThreshold: 38,
  backgroundSoftness: 54,
  backgroundFeather: 2,
  foregroundGuard: 70,
  memoryMb: 64,
  slider: 52,
  runningToken: 0,
};

const capabilities = detectCapabilities();
const demoFilters = listPixelFilters().filter(
  (profile) => profile.id !== "identity",
);
const featureRows = [
  [
    "Fixed stream memory",
    "64 MB ring-buffer ingestion instead of full-frame allocation",
  ],
  ["Overlap-safe tiles", "Kernel radius metadata prevents hard tile borders"],
  ["CPU fallback", "Deterministic fixed-point TypeScript kernels"],
  ["Zig WASM — auto", "configureWasm() once at startup; all pipeline calls use Zig kernel automatically"],
  ["WebGPU", "Compute shader backend for parallel RGBA filters"],
  ["Workers", "Transferable tile payloads and SharedArrayBuffer helper"],
  [
    "Background removal",
    "Downloaded AI subject matte, color-guided soft edges, and transparent PNG export",
  ],
];

const featureLabChecks = [
  {
    id: "labImage",
    label: "Image helpers",
    scope: "make, clone, crop, resize",
  },
  {
    id: "labFacade",
    label: "Facade pipeline",
    scope: "applyFilter, applyFilters, edit, plan",
  },
  {
    id: "labPipeline",
    label: "Low-level pipeline",
    scope: "stats, pipeline, custom tile source/sink",
  },
  {
    id: "labTileProcessor",
    label: "Tile processor",
    scope: "custom processor and CPU adapter contract",
  },
  {
    id: "labMask",
    label: "Masks and background",
    scope: "alpha mask, soft edge, flatten",
  },
  {
    id: "labCodecs",
    label: "Codecs",
    scope: "formats, normalize, encode, convert, optimize",
  },
  {
    id: "labPlanning",
    label: "Asset planning",
    scope: "memory budget, goal presets, format choice",
  },
  {
    id: "labBuffers",
    label: "Buffers and fixed point",
    scope: "ring buffer, stream, shared tile, fixed math",
  },
  {
    id: "labRuntime",
    label: "Runtime exports",
    scope: "capability report and worker availability",
  },
  {
    id: "labWasm",
    label: "WASM auto-boot",
    scope: "configureWasm, isWasmReady, registerProcessor",
  },
] as const;

type FeatureLabId = (typeof featureLabChecks)[number]["id"];

let sourceImage: ImageData | undefined;
let enhancedImage: ImageData | undefined;
let imageBounds: Rect | undefined;
let semanticMask: AlphaMask | undefined;
let semanticBackend: AiBackend | undefined;
let semanticMaskPromise: Promise<AlphaMask> | undefined;
const phantomAi = createPhantomAi();
let aiPreloadPromise: Promise<void> | undefined;

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) {
  throw new Error("Missing #app root.");
}

app.innerHTML = `
  <main class="min-h-screen bg-[#f5f7f2] text-zinc-900">
    <header class="border-b border-zinc-200 bg-white/90 px-5 py-4 backdrop-blur">
      <div class="mx-auto flex max-w-[1440px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Phantom SDK demo</p>
          <h1 class="mt-1 text-3xl font-semibold tracking-normal text-zinc-950">Image Studio for 32K / 64K files</h1>
          <p class="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">Upload a real image, remove AI subject backgrounds, preview tile-safe enhancement, and inspect every SDK layer from filters to memory planning.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold hover:border-emerald-700" for="upload">Import image</label>
          <input id="upload" type="file" accept="image/*" />
          <button class="min-h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50" id="export" disabled>Export preview</button>
        </div>
      </div>
    </header>

    <section class="mx-auto grid max-w-[1440px] items-start gap-3 p-3 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
      <aside class="grid content-start gap-3">
        <section class="rounded-lg border border-zinc-200 bg-white p-3">
          <span class="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Workflow</span>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <button data-operation="enhance" class="operation min-h-12 rounded-md border border-zinc-300 bg-white px-3 text-left text-sm font-semibold text-zinc-800 hover:border-emerald-700 active">
              <span class="block">Enhance</span>
              <span class="block text-xs font-medium opacity-70">tile kernels</span>
            </button>
            <button data-operation="removeBackground" class="operation min-h-12 rounded-md border border-zinc-300 bg-white px-3 text-left text-sm font-semibold text-zinc-800 hover:border-emerald-700">
              <span class="block">Remove background</span>
              <span class="block text-xs font-medium opacity-70">alpha mask</span>
            </button>
          </div>
        </section>

        <section class="rounded-lg border border-zinc-200 bg-white p-3">
          <span class="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Enhancement preset</span>
          <div class="mt-3 grid grid-cols-2 gap-2">
            ${demoFilters
              .map(
                (profile) =>
                  `<button data-filter="${profile.id}" class="preset min-h-12 rounded-md border border-zinc-300 bg-white px-3 text-left text-sm font-semibold text-zinc-800 hover:border-emerald-700 ${profile.id === state.filter ? "active" : ""}">
                    <span class="block">${profile.label}</span>
                    <span class="block text-xs font-medium opacity-70">${profile.category}</span>
                  </button>`,
              )
              .join("")}
          </div>
        </section>

        <section class="rounded-lg border border-zinc-200 bg-white p-3">
          <label for="resolution" class="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Output target</label>
          <select id="resolution" class="mt-3 min-h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm">
            <option value="16k">16K canvas</option>
            <option value="32k" selected>32K pro print</option>
            <option value="64k">64K wall scan</option>
          </select>

          <label for="memory" class="mt-4 block text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Memory lane <strong id="memoryLabel" class="text-emerald-700">64 MB</strong></label>
          <input id="memory" class="mt-3 w-full accent-emerald-700" min="16" max="256" step="16" type="range" value="64" />

          <span class="mt-4 block text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Mask engine</span>
          <div class="mt-3 grid rounded-md border border-zinc-300 bg-zinc-100 p-1" role="group" aria-label="Background removal engine">
            <button data-mask-mode="ai" class="mask-mode active min-h-10 rounded-sm px-3 text-left text-sm font-semibold">
              <span class="block">AI Subject</span>
              <span class="block text-xs font-medium opacity-65">downloaded model</span>
            </button>
          </div>

          <label for="threshold" class="mt-4 block text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Mask cutoff <strong id="thresholdLabel" class="text-emerald-700">38</strong></label>
          <input id="threshold" class="mt-3 w-full accent-emerald-700" min="8" max="96" step="1" type="range" value="38" />

          <label for="softness" class="mt-4 block text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Edge softness <strong id="softnessLabel" class="text-emerald-700">54</strong></label>
          <input id="softness" class="mt-3 w-full accent-emerald-700" min="0" max="96" step="1" type="range" value="54" />

          <div class="mt-4 grid grid-cols-2 gap-3">
            <label for="feather" class="block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Feather <strong id="featherLabel" class="text-emerald-700">2 px</strong></label>
            <label for="guard" class="block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Subject guard <strong id="guardLabel" class="text-emerald-700">70%</strong></label>
            <input id="feather" class="w-full accent-emerald-700" min="0" max="4" step="1" type="range" value="2" />
            <input id="guard" class="w-full accent-emerald-700" min="30" max="90" step="1" type="range" value="70" />
          </div>

          <button class="mt-4 min-h-11 w-full rounded-md bg-emerald-700 px-4 text-sm font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50" id="enhance" disabled>Run workflow</button>
        </section>

        <section class="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          ${metricRow("Loaded file", "fileInfo", "No image")}
          ${metricRow("Full-frame editor", "naiveMemory")}
          ${metricRow("Phantom scratch", "phantomMemory")}
          ${metricRow("Tiles", "tiles")}
          ${metricRow("Reduction", "reduction")}
          ${metricRow("Mask engine", "maskEngine", "-")}
          ${metricRow("Model state", "modelState", "Not loaded")}
          ${metricRow("Removed pixels", "removedPixels", "-")}
        </section>
      </aside>

      <section class="grid min-w-0 content-start gap-3">
        <div class="viewer relative h-[340px] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 shadow-sm 2xl:h-[400px]" id="viewer">
          <canvas class="absolute inset-0 h-full w-full object-contain" id="before" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}"></canvas>
          <canvas class="absolute inset-0 h-full w-full object-contain" id="after" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}"></canvas>
          <div class="absolute bottom-4 left-4 rounded-md bg-white/90 px-3 py-2 text-xs font-bold text-zinc-700 shadow">Before</div>
          <div class="absolute bottom-4 right-4 rounded-md bg-emerald-700 px-3 py-2 text-xs font-bold text-white shadow">After</div>
          <div class="absolute bottom-0 top-0 w-0.5 bg-white shadow" id="splitLine"></div>
          <input class="absolute inset-0 h-full w-full cursor-ew-resize opacity-0" id="split" aria-label="Before after split" type="range" min="0" max="100" value="52" />
          <div class="drop-zone absolute inset-6 grid place-content-center justify-items-center gap-2 rounded-lg border border-dashed border-zinc-400 bg-white/90 text-center text-zinc-800" id="dropZone">
            <strong class="text-2xl">Drop an image here</strong>
            <span class="text-sm text-zinc-600">Use a real photo or scan to test Phantom on your own case.</span>
          </div>
        </div>

        <div class="grid items-start gap-2 md:grid-cols-4">
          ${statBox("Status", "status", "Ready")}
          ${statBox("Preview work", "sampled", "0 tiles")}
          ${statBox("Elapsed", "elapsed", "0 ms")}
          ${statBox("Throughput", "throughput", "-")}
        </div>

        <section class="rounded-lg border border-zinc-200 bg-white p-3">
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 class="text-lg font-semibold text-zinc-950">SDK feature surface</h2>
              <p class="text-sm text-zinc-600">The demo exercises the same public APIs that consumers import from the SDK.</p>
            </div>
            <span class="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700" id="backendProfile"></span>
          </div>
          <div class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            ${featureRows
              .map(
                ([title, body]) =>
                  `<div class="rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
                    <strong class="block text-sm text-zinc-950">${title}</strong>
                    <span class="mt-1 block text-sm leading-5 text-zinc-600">${body}</span>
                  </div>`,
              )
              .join("")}
          </div>
        </section>
      </section>

      <aside class="grid content-start gap-3">
        <section class="rounded-lg border border-zinc-200 bg-white p-3">
          <h2 class="text-lg font-semibold text-zinc-950">Runtime capability</h2>
          <div class="mt-3 grid gap-2 text-sm">
            ${metricRow("Backend", "capBackend")}
            ${metricRow("WebGPU", "capWebgpu")}
            ${metricRow("Shared memory", "capShared")}
            ${metricRow("CPU lanes", "capLanes")}
          </div>
        </section>

        <section class="rounded-lg border border-zinc-200 bg-white p-3">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-lg font-semibold text-zinc-950">Feature lab</h2>
            <button id="runFeatureLab" class="min-h-9 rounded-md border border-zinc-300 bg-white px-3 text-xs font-bold text-zinc-800 hover:border-emerald-700">Run checks</button>
          </div>
          <div class="mt-3 grid max-h-[390px] gap-2 overflow-y-auto pr-1">
            ${featureLabChecks
              .map(
                (check) =>
                  `<div id="${check.id}" class="rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <strong class="block text-sm text-zinc-950">${check.label}</strong>
                        <span class="mt-1 block text-xs leading-5 text-zinc-600">${check.scope}</span>
                      </div>
                      <span data-lab-status class="rounded-full bg-zinc-200 px-2 py-1 text-xs font-bold text-zinc-600">idle</span>
                    </div>
                    <span data-lab-detail class="mt-2 block text-xs leading-5 text-zinc-500">Waiting for browser check.</span>
                  </div>`,
              )
              .join("")}
          </div>
        </section>

        <section class="rounded-lg border border-zinc-200 bg-white p-3">
          <h2 class="text-lg font-semibold text-zinc-950">Filter profiles</h2>
          <div class="mt-3 grid max-h-[300px] gap-2 overflow-y-auto pr-1">
            ${listPixelFilters()
              .map(
                (profile) =>
                  `<div class="rounded-md border border-zinc-200 bg-white p-2.5">
                    <div class="flex items-center justify-between gap-3">
                      <strong class="text-sm text-zinc-950">${profile.label}</strong>
                      <span class="rounded-full bg-zinc-100 px-2 py-1 text-xs font-bold text-zinc-600">overlap ${profile.overlap}</span>
                    </div>
                    <p class="mt-1 text-xs leading-5 text-zinc-600">${profile.description}</p>
                  </div>`,
              )
              .join("")}
          </div>
        </section>

        <section class="rounded-lg border border-zinc-200 bg-zinc-950 p-3 text-zinc-100">
          <h2 class="text-lg font-semibold">Use the SDK</h2>
  <pre class="mt-3 overflow-auto rounded-md bg-black/40 p-3 text-xs leading-5 text-emerald-100"><code>import phantom, { configureWasm }
  from "@paramission-lab/phantom";

// ⚡ One call — all pipeline calls
// use Zig WASM automatically.
await configureWasm("/phantom_kernel.wasm");

const out = await phantom
  .edit(image)
  .adjust({ brightness: 10, contrast: 15 })
  .filter("smoothEnhance")
  .run();</code></pre>
        </section>
      </aside>
    </section>
  </main>
`;

const beforeCanvas = requireElement<HTMLCanvasElement>("before");
const afterCanvas = requireElement<HTMLCanvasElement>("after");
const beforeContext = require2dContext(beforeCanvas, false);
const afterContext = require2dContext(afterCanvas, false);

bindControls();
drawEmptyPreview();
renderPlan();
renderCapabilities();
updateOperationUi();
applySplit();
setImageControls(false);
void runFeatureLab();
window.addEventListener("pagehide", () => {
  void phantomAi.dispose();
});

function bindControls(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-operation]",
  )) {
    button.addEventListener("click", () => {
      state.operation = button.dataset.operation as OperationMode;
      updateOperationUi();
      renderPlan();
      if (state.operation === "removeBackground") {
        startAiPreload();
      }
      if (sourceImage !== undefined) {
        void runCurrentOperation();
      }
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-mask-mode]",
  )) {
    button.addEventListener("click", () => {
      updateOperationUi();
      renderPlan();
      startAiPreload();
      if (state.operation === "removeBackground" && sourceImage !== undefined) {
        void runCurrentOperation();
      }
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-filter]",
  )) {
    button.addEventListener("click", () => {
      state.operation = "enhance";
      state.filter = button.dataset.filter as PixelFilter;
      for (const option of document.querySelectorAll("[data-filter]")) {
        option.classList.toggle("active", option === button);
      }
      updateOperationUi();
      renderPlan();
      if (sourceImage !== undefined) {
        void runCurrentOperation();
      }
    });
  }

  requireElement<HTMLSelectElement>("resolution").addEventListener(
    "change",
    (event) => {
      state.resolution = (event.currentTarget as HTMLSelectElement)
        .value as ResolutionKey;
      renderPlan();
    },
  );

  requireElement<HTMLInputElement>("threshold").addEventListener(
    "input",
    (event) => {
      state.backgroundThreshold = Number(
        (event.currentTarget as HTMLInputElement).value,
      );
      requireElement("thresholdLabel").textContent =
        state.backgroundThreshold.toString();
      if (state.operation === "removeBackground" && sourceImage !== undefined) {
        void runCurrentOperation();
      }
    },
  );

  requireElement<HTMLInputElement>("softness").addEventListener(
    "input",
    (event) => {
      state.backgroundSoftness = Number(
        (event.currentTarget as HTMLInputElement).value,
      );
      requireElement("softnessLabel").textContent =
        state.backgroundSoftness.toString();
      if (state.operation === "removeBackground" && sourceImage !== undefined) {
        void runCurrentOperation();
      }
    },
  );

  requireElement<HTMLInputElement>("feather").addEventListener(
    "input",
    (event) => {
      state.backgroundFeather = Number(
        (event.currentTarget as HTMLInputElement).value,
      );
      requireElement("featherLabel").textContent =
        `${state.backgroundFeather} px`;
      if (state.operation === "removeBackground" && sourceImage !== undefined) {
        void runCurrentOperation();
      }
    },
  );

  requireElement<HTMLInputElement>("guard").addEventListener(
    "input",
    (event) => {
      state.foregroundGuard = Number(
        (event.currentTarget as HTMLInputElement).value,
      );
      requireElement("guardLabel").textContent = `${state.foregroundGuard}%`;
      if (state.operation === "removeBackground" && sourceImage !== undefined) {
        void runCurrentOperation();
      }
    },
  );

  requireElement<HTMLInputElement>("memory").addEventListener(
    "input",
    (event) => {
      state.memoryMb = Number((event.currentTarget as HTMLInputElement).value);
      requireElement("memoryLabel").textContent = `${state.memoryMb} MB`;
      renderPlan();
    },
  );

  requireElement<HTMLInputElement>("split").addEventListener(
    "input",
    (event) => {
      state.slider = Number((event.currentTarget as HTMLInputElement).value);
      applySplit();
    },
  );

  requireElement("enhance").addEventListener("click", () => {
    void runCurrentOperation();
  });

  requireElement("runFeatureLab").addEventListener("click", () => {
    void runFeatureLab();
  });

  requireElement("export").addEventListener("click", () => {
    exportPreview();
  });

  requireElement<HTMLInputElement>("upload").addEventListener(
    "change",
    (event) => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (file !== undefined) {
        void loadImageFile(file);
      }
    },
  );

  const viewer = requireElement("viewer");
  viewer.addEventListener("dragover", (event) => {
    event.preventDefault();
    viewer.classList.add("dragging");
  });
  viewer.addEventListener("dragleave", () => {
    viewer.classList.remove("dragging");
  });
  viewer.addEventListener("drop", (event) => {
    event.preventDefault();
    viewer.classList.remove("dragging");
    const file = event.dataTransfer?.files[0];
    if (file !== undefined) {
      void loadImageFile(file);
    }
  });
}

function renderPlan(): void {
  const target = resolutions[state.resolution];
  const lanes = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
  const overlap =
    state.operation === "removeBackground"
      ? 0
      : getPixelFilterOverlap(state.filter);
  const tileSize = chooseTileSize({
    maxBytes: state.memoryMb * 1024 * 1024,
    overlap,
    maxTileSize: 4096,
    minTileSize: 256,
  });
  const stats = describeProcessingPlan(target, {
    tileSize,
    overlap,
    filter: state.filter,
    workerLanes: lanes,
  });

  requireElement("naiveMemory").textContent = formatBytes(stats.fullFrameBytes);
  requireElement("phantomMemory").textContent = formatBytes(
    stats.estimatedScratchBytes,
  );
  requireElement("tiles").textContent = stats.tileCount.toLocaleString();
  requireElement("reduction").textContent =
    `${stats.memoryReductionRatio.toFixed(1)}x`;
  requireElement("backendProfile").textContent =
    state.operation === "removeBackground"
      ? `AI subject • ${stats.tileSize}px mask tiles • soft alpha`
      : `${stats.filter} • ${stats.tileSize}px tiles • ${stats.overlap}px overlap`;
}

function renderCapabilities(): void {
  requireElement("capBackend").textContent = capabilities.backend;
  requireElement("capWebgpu").textContent = capabilities.webgpu
    ? "available"
    : "fallback";
  requireElement("capShared").textContent = capabilities.sharedArrayBuffer
    ? "available"
    : "isolated off";
  requireElement("capLanes").textContent =
    capabilities.hardwareConcurrency.toLocaleString();
}

async function runFeatureLab(): Promise<void> {
  const runButton = requireElement<HTMLButtonElement>("runFeatureLab");
  runButton.disabled = true;
  runButton.textContent = "Running";

  for (const check of featureLabChecks) {
    setFeatureLabStatus(check.id, "running", "Running browser check...");
  }

  const runners: Record<FeatureLabId, () => Promise<string> | string> = {
    labImage: runImageHelperLab,
    labFacade: runFacadeLab,
    labPipeline: runPipelineLab,
    labTileProcessor: runTileProcessorLab,
    labMask: runMaskLab,
    labCodecs: runCodecLab,
    labPlanning: runPlanningLab,
    labBuffers: runBufferLab,
    labRuntime: runRuntimeLab,
    labWasm: runWasmLab,
  };

  for (const check of featureLabChecks) {
    try {
      const detail = await runners[check.id]();
      setFeatureLabStatus(check.id, "pass", detail);
    } catch (error: unknown) {
      setFeatureLabStatus(check.id, "fail", readableError(error));
    }
  }

  runButton.disabled = false;
  runButton.textContent = "Run checks";
}

function runImageHelperLab(): string {
  const generated = makeImage(1, 1, { r: 12, g: 34, b: 56 });
  const raw = createLabImage();
  const cloned = cloneRawImage(raw);
  const cropped = cropImage(cloned, { x: 1, y: 1, width: 4, height: 3 });
  const resized = resizeImage(cropped, 8, 6, { method: "bilinear" });

  return `${generated.data[0] ?? 0}/${raw.width}x${raw.height} -> ${cropped.width}x${cropped.height} crop -> ${resized.width}x${resized.height} resize`;
}

async function runFacadeLab(): Promise<string> {
  const raw = createLabImage();
  const one = await applyFilter(raw, "invert", { tileSize: 3 });
  const many = await applyFilters(raw, ["grayscale", "invert"], {
    tileSize: 3,
  });
  const edited = await phantom
    .edit(raw)
    .crop({ x: 0, y: 0, width: 3, height: 3 })
    .resize(6, 6, { method: "nearest" })
    .filter("identity", { tileSize: 3 })
    .run();
  const plan = await processImage(raw).plan({ goal: "preview" });
  const assetPlan = planAsset(raw, { goal: "delivery" });

  return `${one.data.byteLength + many.data.byteLength + edited.data.byteLength} bytes processed; preview ${plan.encode.format}, delivery ${assetPlan.encode.format}`;
}

async function runPipelineLab(): Promise<string> {
  const raw = createLabImage();
  const withStats = await processRawImageWithStats(raw, {
    filter: "smoothEnhance",
    tileSize: 3,
  });
  const piped = await processRawImagePipeline(
    raw,
    [
      { filter: "grayscale", overlap: 0 },
      { filter: "invert", overlap: 0 },
    ],
    { tileSize: 3 },
  );
  const output = createRawRgbaImage({ width: raw.width, height: raw.height });
  await processTileSource(
    { width: raw.width, height: raw.height },
    createRawTileSource(raw),
    createRawTileSink(output),
    { filter: "identity", overlap: 0, tileSize: 3 },
  );

  return `${withStats.stats.processedTiles}/${withStats.stats.totalTiles} tiles, ${piped.data.byteLength + output.data.byteLength} output bytes`;
}

async function runTileProcessorLab(): Promise<string> {
  const raw = createLabImage();
  let customTiles = 0;
  const demoProcessor: TileProcessor = {
    id: "demo-processor",
    processTile(payload, filter) {
      customTiles += 1;
      return applyFilterToTile(payload, filter);
    },
  };

  const custom = await processRawImage(raw, {
    filter: "identity",
    overlap: 0,
    tileSize: 3,
    tileProcessor: demoProcessor,
  });
  const cpu = await processRawImage(raw, {
    filter: "invert",
    overlap: 0,
    tileSize: 3,
    tileProcessor: cpuTileProcessor,
  });

  return `${customTiles} custom tiles, CPU adapter ${custom.data.byteLength + cpu.data.byteLength} bytes`;
}

function runMaskLab(): string {
  const raw = createLabImage();
  const mask: AlphaMask = {
    width: raw.width,
    height: raw.height,
    data: new Uint8Array(raw.width * raw.height),
  };

  for (let index = 0; index < mask.data.length; index += 1) {
    mask.data[index] = index % raw.width < raw.width / 2 ? 255 : 16;
  }

  const refined = applyAlphaMask(raw, mask, {
    threshold: 32,
    softness: 48,
    featherRadius: 1,
  });
  const alias = applyMask(raw, mask, {
    threshold: 32,
    softness: 16,
    featherRadius: 0,
  });
  const flattened = phantom.replaceBackground(refined, {
    r: 245,
    g: 247,
    b: 242,
  });

  return `${refined.removedPixels + alias.removedPixels} removed samples, flattened alpha ${flattened.data[3] ?? 0}`;
}

async function runCodecLab(): Promise<string> {
  const raw = createLabImage();
  const normalized = normalizeImageFormat(".jpg");
  const profile = getImageFormatProfile(normalized);
  const formats = listImageFormats();
  const pngEncodable = canEncodeImageFormat("png");
  const encoded = await encodeRawImage(raw, { format: "png" });
  const converted = await convertImage(raw, { format: "png" });
  const optimized = await optimizeImage(encoded.blob, { format: "png" });

  return `${formats.length} formats, ${profile.mimeType}, png=${pngEncodable ? "encode" : "read-only"}, ${encoded.outputBytes + converted.outputBytes + optimized.outputBytes} bytes`;
}

function runPlanningLab(): string {
  const raw = createLabImage();
  const preview = createPhantomAssetPlan(raw, { goal: "preview" });
  const cutout = createPhantomAssetPlan(raw, {
    goal: "transparent-cutout",
    maxWorkerBytes: 4 * 1024 * 1024,
  });
  const stats = describeProcessingPlan(raw, {
    tileSize: preview.tileSize,
    overlap: preview.overlap,
    filter: preview.filters[0] ?? "identity",
  });

  return `${preview.goal}:${preview.encode.format}, ${cutout.goal}:${cutout.encode.format}, ${stats.tileCount} planned tiles`;
}

async function runBufferLab(): Promise<string> {
  const ring = new FixedByteRingBuffer(8);
  ring.writeOrThrow(Uint8Array.from([1, 2, 3, 4, 5]));
  const readTarget = new Uint8Array(3);
  const read = ring.read(readTarget);
  const chunks: number[] = [];
  const streamed = await streamChunksToFixedBuffer(
    [Uint8Array.from([6, 7]), Uint8Array.from([8, 9])],
    (chunk) => {
      chunks.push(chunk.byteLength);
    },
    4,
  );
  const shared = new SharedTileBuffer(16, { preferShared: true });
  shared.view(4, 4).fill(9);
  const fixedSample = fromFixed(
    multiplyFixed(FIXED_ONE, toFixed(0.5)) + toFixed(0.25),
  );

  return `${read} ring bytes, ${streamed} streamed, shared=${shared.shared ? "yes" : "no"}, fixed=${fixedSample.toFixed(2)}, clamp=${clampU8(300)}`;
}

function runRuntimeLab(): string {
  const report = detectCapabilities();
  const workerAvailable = typeof Worker !== "undefined";
  const filters = listPixelFilters().length;

  return `${report.backend}, workers=${workerAvailable ? "available" : "unavailable"}, filters=${filters}, lanes=${report.hardwareConcurrency}`;
}

async function runWasmLab(): Promise<string> {
  // Verify configureWasm() / registerProcessor() / isWasmReady() API surface
  // without a real .wasm file — confirm that the registry round-trips correctly.
  const beforeBoot = isWasmReady();

  // Register a stub processor to prove the registry accepts custom processors
  const stubProcessor: TileProcessor = {
    id: "stub-wasm",
    processTile(payload, filter) {
      // Passthrough — behaves like identity
      return applyFilterToTile({ descriptor: payload.descriptor, rgba: payload.rgba }, filter);
    },
  };
  // Low-level: registerProcessor directly
  const { registerProcessor } = await import("../../src/core/wasm-registry.js");
  registerProcessor(stubProcessor);
  const afterRegister = isWasmReady();
  const registered = getRegisteredProcessor();

  // Confirm the registered processor is the one we set
  const idMatch = registered?.id === "stub-wasm";

  // Revert to CPU baseline
  registerProcessor(null);
  const afterClear = isWasmReady();

  // Test configureWasm(null) — should also clear without error
  await configureWasm(null);
  const afterConfigureNull = isWasmReady();

  return `before=${String(beforeBoot)}, after-register=${String(afterRegister)}, id-match=${String(idMatch)}, after-clear=${String(afterClear)}, after-configure-null=${String(afterConfigureNull)}`;
}

async function runCurrentOperation(): Promise<void> {
  if (sourceImage === undefined) {
    requireElement("status").textContent = "Upload image";
    return;
  }

  const token = state.runningToken + 1;
  state.runningToken = token;
  setBusy(true);

  const started = performance.now();
  let failure: unknown;
  try {
    if (state.operation === "removeBackground") {
      await removeBackgroundPreview(token, started);
    } else {
      await enhancePreview(token, started);
    }
  } catch (error: unknown) {
    failure = error;
    console.error(error);
  } finally {
    if (token === state.runningToken) {
      setBusy(false);
      if (failure !== undefined) {
        requireElement("status").textContent = "Failed";
        requireElement("modelState").textContent = readableError(failure);
      }
    }
  }
}

async function enhancePreview(token: number, started: number): Promise<void> {
  if (sourceImage === undefined) {
    return;
  }

  const source = sourceImage;
  const output = new ImageData(source.width, source.height);
  const overlap = getPixelFilterOverlap(state.filter);
  const tiles = planTiles({
    width: source.width,
    height: source.height,
    tileSize: PREVIEW_TILE_SIZE,
    overlap,
  });
  let processedBytes = 0;
  let processedTiles = 0;
  let frameStarted = performance.now();

  for (const tile of tiles) {
    if (token !== state.runningToken) {
      return;
    }

    const tileInput = readImageRect(source, tile.input);
    const result = applyFilterToTile(
      { descriptor: tile, rgba: tileInput },
      state.filter,
    );
    writeImageRect(output, tile.output, result.rgba);
    paintOutputTile(tile, result.rgba);
    processedBytes += tileInput.byteLength + result.rgba.byteLength;
    processedTiles += 1;

    if (performance.now() - frameStarted >= FRAME_BUDGET_MS) {
      updateProgress(processedTiles, tiles.length, started, processedBytes);
      await nextFrame();
      frameStarted = performance.now();
    }
  }

  enhancedImage = output;
  afterContext.putImageData(output, 0, 0);
  updateProgress(processedTiles, tiles.length, started, processedBytes);
  requireElement("maskEngine").textContent = "-";
  requireElement("removedPixels").textContent = "-";
}

async function removeBackgroundPreview(
  token: number,
  started: number,
): Promise<void> {
  if (sourceImage === undefined) {
    return;
  }

  const bounds = imageBounds ?? {
    x: 0,
    y: 0,
    width: sourceImage.width,
    height: sourceImage.height,
  };
  const cropped = readImageRect(sourceImage, bounds);

  await nextFrame();
  if (token !== state.runningToken) {
    return;
  }

  await removeBackgroundWithAi(cropped, bounds, token, started);
}

async function removeBackgroundWithAi(
  cropped: Uint8Array,
  bounds: Rect,
  token: number,
  started: number,
): Promise<void> {
  const mask = await getSemanticMask(cropped, bounds);
  if (token !== state.runningToken) {
    return;
  }

  const result = applyAlphaMask(
    { width: bounds.width, height: bounds.height, data: cropped },
    mask,
    resolveAiMaskRefinementOptions({
      maskCutoff: state.backgroundThreshold,
      softness: state.backgroundSoftness,
      featherRadius: state.backgroundFeather,
      subjectGuard: state.foregroundGuard,
    }),
  );
  const output = new ImageData(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  writeImageRect(output, bounds, result.data);
  enhancedImage = output;
  paintImageWithCheckerboard(output);
  updateMaskProgress(
    result.removedPixels,
    bounds.width * bounds.height,
    started,
    cropped.byteLength + result.data.byteLength + result.mask.byteLength,
  );
  requireElement("maskEngine").textContent =
    `AI subject • ${((result.partialPixels / Math.max(result.mask.length, 1)) * 100).toFixed(1)}% soft edge`;
  requireElement("modelState").textContent =
    `${semanticBackend?.toUpperCase() ?? "AI"} • cached locally`;
}

async function getSemanticMask(
  cropped: Uint8Array,
  bounds: Rect,
): Promise<AlphaMask> {
  if (semanticMask !== undefined) {
    return semanticMask;
  }

  semanticMaskPromise ??= (async () => {
    const canvas = document.createElement("canvas");
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    const context = require2dContext(canvas, true);
    context.putImageData(
      new ImageData(
        new Uint8ClampedArray(cropped),
        bounds.width,
        bounds.height,
      ),
      0,
      0,
    );
    const result = await phantomAi.createMask(canvas, updateAiProgress);
    semanticBackend = result.backend;
    semanticMask = result.mask;
    return result.mask;
  })().catch((error: unknown) => {
    semanticMaskPromise = undefined;
    throw error;
  });

  return semanticMaskPromise;
}

function startAiPreload(): void {
  void preloadAiModel().catch((error: unknown) => {
    requireElement("modelState").textContent = readableError(error);
  });
}

function preloadAiModel(): Promise<void> {
  aiPreloadPromise ??= phantomAi
    .preload(updateAiProgress)
    .then((result) => {
      semanticBackend = result.backend;
      requireElement("modelState").textContent =
        `${result.backend.toUpperCase()} • model ready`;
    })
    .catch((error: unknown) => {
      aiPreloadPromise = undefined;
      throw error;
    });
  return aiPreloadPromise;
}

function updateAiProgress(progress: AiProgress): void {
  requireElement("modelState").textContent =
    progress.percent === undefined
      ? progress.label
      : `${progress.label} ${progress.percent.toFixed(0)}%`;
}

function readImageRect(image: ImageData, rect: Rect): Uint8Array {
  const output = new Uint8Array(rect.width * rect.height * RGBA_CHANNELS);

  for (let row = 0; row < rect.height; row += 1) {
    const sourceStart = ((rect.y + row) * image.width + rect.x) * RGBA_CHANNELS;
    const sourceEnd = sourceStart + rect.width * RGBA_CHANNELS;
    output.set(
      image.data.subarray(sourceStart, sourceEnd),
      row * rect.width * RGBA_CHANNELS,
    );
  }

  return output;
}

function writeImageRect(image: ImageData, rect: Rect, data: Uint8Array): void {
  for (let row = 0; row < rect.height; row += 1) {
    const targetStart = ((rect.y + row) * image.width + rect.x) * RGBA_CHANNELS;
    const sourceStart = row * rect.width * RGBA_CHANNELS;
    const sourceEnd = sourceStart + rect.width * RGBA_CHANNELS;
    image.data.set(data.subarray(sourceStart, sourceEnd), targetStart);
  }
}

function paintOutputTile(tile: TileDescriptor, data: Uint8Array): void {
  const image = new ImageData(
    new Uint8ClampedArray(data),
    tile.output.width,
    tile.output.height,
  );
  afterContext.putImageData(image, tile.output.x, tile.output.y);
}

function paintImageWithCheckerboard(image: ImageData): void {
  const display = new ImageData(new Uint8ClampedArray(image.data), image.width);

  for (let y = 0; y < display.height; y += 1) {
    for (let x = 0; x < display.width; x += 1) {
      const index = (y * display.width + x) * RGBA_CHANNELS;
      const alpha = (display.data[index + 3] ?? 255) / 255;
      const checker = Math.floor(x / 16) + Math.floor(y / 16);
      const background = checker % 2 === 0 ? 234 : 205;

      display.data[index] = Math.round(
        (display.data[index] ?? 0) * alpha + background * (1 - alpha),
      );
      display.data[index + 1] = Math.round(
        (display.data[index + 1] ?? 0) * alpha + background * (1 - alpha),
      );
      display.data[index + 2] = Math.round(
        (display.data[index + 2] ?? 0) * alpha + background * (1 - alpha),
      );
      display.data[index + 3] = 255;
    }
  }

  afterContext.putImageData(display, 0, 0);
}

async function loadImageFile(file: File): Promise<void> {
  if (!file.type.startsWith("image/")) {
    requireElement("status").textContent = "Unsupported file";
    return;
  }

  state.runningToken += 1;
  semanticMask = undefined;
  semanticMaskPromise = undefined;
  requireElement("status").textContent = "Loading";
  if (state.operation === "removeBackground") {
    startAiPreload();
  }
  const bitmap = await createImageBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const scale = Math.min(
    PREVIEW_WIDTH / originalWidth,
    PREVIEW_HEIGHT / originalHeight,
  );
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  imageBounds = {
    x: Math.round((PREVIEW_WIDTH - width) / 2),
    y: Math.round((PREVIEW_HEIGHT - height) / 2),
    width,
    height,
  };
  beforeContext.fillStyle = "#111814";
  beforeContext.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  beforeContext.drawImage(
    bitmap,
    imageBounds.x,
    imageBounds.y,
    imageBounds.width,
    imageBounds.height,
  );
  bitmap.close();
  sourceImage = beforeContext.getImageData(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  enhancedImage = new ImageData(
    new Uint8ClampedArray(sourceImage.data),
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
  );
  afterContext.putImageData(enhancedImage, 0, 0);
  requireElement("fileInfo").textContent =
    `${file.name} • ${originalWidth.toLocaleString()}x${originalHeight.toLocaleString()} • ${formatBytes(file.size)}`;
  requireElement("status").textContent = "Imported";
  requireElement("modelState").textContent =
    semanticBackend === undefined
      ? "Not loaded"
      : `${semanticBackend.toUpperCase()} • model cached`;
  resetProgress();
  setImageControls(true);
  requireElement("dropZone").classList.add("hidden");
  void runCurrentOperation();
}

function exportPreview(): void {
  if (enhancedImage === undefined) {
    return;
  }

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = enhancedImage.width;
  exportCanvas.height = enhancedImage.height;
  const exportContext = require2dContext(exportCanvas, true);
  exportContext.putImageData(enhancedImage, 0, 0);

  const link = document.createElement("a");
  link.href = exportCanvas.toDataURL("image/png");
  link.download = `phantom-${operationSlug()}-${resolutions[state.resolution].label.replaceAll(" ", "-").toLowerCase()}.png`;
  link.click();
}

function applySplit(): void {
  afterCanvas.style.clipPath = `inset(0 0 0 ${state.slider}%)`;
  requireElement("splitLine").style.left = `${state.slider}%`;
}

function updateProgress(
  processedTiles: number,
  totalTiles: number,
  started: number,
  processedBytes: number,
): void {
  const elapsed = performance.now() - started;
  const mbPerSecond =
    processedBytes / (1024 * 1024) / Math.max(elapsed / 1000, 0.001);
  requireElement("sampled").textContent =
    `${processedTiles}/${totalTiles} tiles`;
  requireElement("elapsed").textContent = `${elapsed.toFixed(1)} ms`;
  requireElement("throughput").textContent = `${mbPerSecond.toFixed(0)} MB/s`;
}

function updateMaskProgress(
  removedPixels: number,
  totalPixels: number,
  started: number,
  processedBytes: number,
): void {
  const elapsed = performance.now() - started;
  const mbPerSecond =
    processedBytes / (1024 * 1024) / Math.max(elapsed / 1000, 0.001);
  const removedRatio = (removedPixels / Math.max(totalPixels, 1)) * 100;
  requireElement("sampled").textContent = `${removedRatio.toFixed(1)}% mask`;
  requireElement("elapsed").textContent = `${elapsed.toFixed(1)} ms`;
  requireElement("throughput").textContent = `${mbPerSecond.toFixed(0)} MB/s`;
  requireElement("removedPixels").textContent =
    `${removedPixels.toLocaleString()} px`;
}

function setBusy(busy: boolean): void {
  const activeVerb =
    state.operation === "removeBackground" ? "Removing" : "Enhancing";
  const idleLabel =
    state.operation === "removeBackground"
      ? "Remove background"
      : "Enhance image";
  requireElement("status").textContent = busy ? activeVerb : "Ready";
  requireElement("enhance").textContent = busy ? `${activeVerb}...` : idleLabel;
  requireElement<HTMLButtonElement>("enhance").disabled =
    busy || sourceImage === undefined;
}

function updateOperationUi(): void {
  for (const option of document.querySelectorAll("[data-operation]")) {
    option.classList.toggle(
      "active",
      (option as HTMLElement).dataset.operation === state.operation,
    );
  }

  for (const option of document.querySelectorAll<HTMLButtonElement>(
    "[data-mask-mode]",
  )) {
    const disabled = state.operation !== "removeBackground";
    option.disabled = disabled;
    option.classList.toggle("active", option.dataset.maskMode === "ai");
    option.classList.toggle("cursor-not-allowed", disabled);
    option.classList.toggle("opacity-50", disabled);
  }

  const threshold = requireElement<HTMLInputElement>("threshold");
  const backgroundControls = [
    threshold,
    requireElement<HTMLInputElement>("softness"),
    requireElement<HTMLInputElement>("feather"),
    requireElement<HTMLInputElement>("guard"),
  ];

  for (const control of backgroundControls) {
    control.disabled = state.operation !== "removeBackground";
    control.classList.toggle("opacity-50", control.disabled);
    control.classList.toggle("cursor-not-allowed", control.disabled);
  }
  setBusy(false);
}

function operationSlug(): string {
  return state.operation === "removeBackground"
    ? "remove-background"
    : state.filter;
}

function createLabImage(): RawRgbaImage {
  const image = createRawRgbaImage(
    { width: 6, height: 5 },
    { r: 0, g: 0, b: 0 },
  );

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * RGBA_CHANNELS;
      image.data[index] = 20 + x * 24;
      image.data[index + 1] = 48 + y * 28;
      image.data[index + 2] = 160 - x * 10 + y * 6;
      image.data[index + 3] = x + y > 6 ? 168 : 255;
    }
  }

  return image;
}

function setFeatureLabStatus(
  id: FeatureLabId,
  status: "running" | "pass" | "fail",
  detail: string,
): void {
  const card = requireElement(id);
  const badge = card.querySelector<HTMLElement>("[data-lab-status]");
  const body = card.querySelector<HTMLElement>("[data-lab-detail]");

  if (badge === null || body === null) {
    throw new Error(`Missing feature lab nodes for ${id}.`);
  }

  const styles = {
    running: "bg-blue-100 text-blue-700",
    pass: "bg-emerald-100 text-emerald-700",
    fail: "bg-red-100 text-red-700",
  };

  badge.className = `rounded-full px-2 py-1 text-xs font-bold ${styles[status]}`;
  badge.textContent = status;
  body.textContent = detail;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function drawEmptyPreview(): void {
  beforeContext.fillStyle = "#111814";
  beforeContext.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  afterContext.fillStyle = "#111814";
  afterContext.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  requireElement("status").textContent = "Upload image";
  imageBounds = undefined;
  resetProgress();
}

function resetProgress(): void {
  requireElement("sampled").textContent = "0 tiles";
  requireElement("elapsed").textContent = "0 ms";
  requireElement("throughput").textContent = "-";
  requireElement("maskEngine").textContent = "-";
  requireElement("modelState").textContent =
    semanticBackend === undefined
      ? "Not loaded"
      : `${semanticBackend.toUpperCase()} • model cached`;
  requireElement("removedPixels").textContent = "-";
}

function setImageControls(enabled: boolean): void {
  requireElement<HTMLButtonElement>("enhance").disabled = !enabled;
  requireElement<HTMLButtonElement>("export").disabled = !enabled;
}

function require2dContext(
  canvas: HTMLCanvasElement,
  alpha: boolean,
): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { alpha });
  if (context === null) {
    throw new Error("2D canvas is unavailable.");
  }
  return context;
}

function requireElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing element #${id}.`);
  }
  return element as T;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown processing error";
}

function metricRow(label: string, id: string, initial = ""): string {
  return `<div class="flex min-h-11 items-center justify-between gap-3 border-t border-zinc-100 px-3 py-2 first:border-t-0">
    <span class="text-sm text-zinc-500">${label}</span>
    <strong id="${id}" class="text-right text-sm font-semibold text-emerald-700">${initial}</strong>
  </div>`;
}

function statBox(label: string, id: string, initial: string): string {
  return `<div class="min-h-20 rounded-lg border border-zinc-200 bg-white p-2.5">
    <span class="block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">${label}</span>
    <strong id="${id}" class="mt-1 block text-lg font-semibold text-zinc-950">${initial}</strong>
  </div>`;
}
