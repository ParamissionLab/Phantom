import { applyFilterToTile } from "../core/kernels.js";
import type { PixelFilter, TilePayload, TileResult } from "../core/types.js";

interface WorkerRequest {
  readonly id: number;
  readonly filter: PixelFilter;
  readonly payload: TilePayload;
}

interface WorkerResponse {
  readonly id: number;
  readonly result?: TileResult;
  readonly error?: string;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, filter, payload } = event.data;

  try {
    const result = applyFilterToTile(payload, filter);
    const response: WorkerResponse = { id, result };
    self.postMessage(response, { transfer: [result.rgba.buffer] });
  } catch (error) {
    const response: WorkerResponse = {
      id,
      error: error instanceof Error ? error.message : "Unknown worker error.",
    };
    self.postMessage(response);
  }
};
