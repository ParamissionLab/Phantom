import type { PixelFilter, TilePayload, TileResult } from "../core/types.js";

interface PendingTile {
  readonly payload: TilePayload;
  readonly filter: PixelFilter;
  readonly resolve: (result: TileResult) => void;
  readonly reject: (reason: unknown) => void;
}

interface InflightTile extends PendingTile {
  readonly worker: Worker;
}

interface WorkerResponse {
  readonly id: number;
  readonly result?: TileResult;
  readonly error?: string;
}

/**
 * Browser worker pool for parallel tile execution.
 */
export class TileWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly idleWorkers: Worker[] = [];
  private readonly pendingQueue: PendingTile[] = [];
  private readonly inflight = new Map<number, InflightTile>();
  private nextId = 1;
  private disposed = false;

  public constructor(
    workerUrl: URL | string,
    concurrency = globalThis.navigator?.hardwareConcurrency ?? 2,
  ) {
    if (!Number.isInteger(concurrency) || concurrency <= 0) {
      throw new Error("concurrency must be a positive integer.");
    }

    for (let index = 0; index < concurrency; index += 1) {
      const worker = new Worker(workerUrl, { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleMessage(worker, event.data);
      };
      worker.onerror = (event) => {
        this.rejectWorkerTasks(worker, event.message);
      };
      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  public runTile(
    payload: TilePayload,
    filter: PixelFilter,
  ): Promise<TileResult> {
    if (this.disposed) {
      return Promise.reject(new Error("TileWorkerPool has been disposed."));
    }

    return new Promise<TileResult>((resolve, reject) => {
      this.pendingQueue.push({ payload, filter, resolve, reject });
      this.drainQueue();
    });
  }

  public dispose(): void {
    this.disposed = true;
    for (const worker of this.workers) {
      worker.terminate();
    }
    for (const task of this.inflight.values()) {
      task.reject(new Error("TileWorkerPool disposed before tile completed."));
    }
    for (const task of this.pendingQueue.splice(0)) {
      task.reject(new Error("TileWorkerPool disposed before tile started."));
    }
    this.inflight.clear();
    this.idleWorkers.length = 0;
  }

  private drainQueue(): void {
    while (this.idleWorkers.length > 0 && this.pendingQueue.length > 0) {
      const worker = this.idleWorkers.pop();
      const task = this.pendingQueue.shift();
      if (worker === undefined || task === undefined) {
        return;
      }

      const id = this.nextId;
      this.nextId += 1;
      this.inflight.set(id, { ...task, worker });

      // Only transfer when the view owns its entire ArrayBuffer. Transferring
      // the buffer behind a subarray (pooled tile buffers, packed frames)
      // detaches memory the caller still owns and hands the worker the wrong
      // byte range. Detach the exclusively-owned case, copy the shared one.
      const rgba = task.payload.rgba;
      const ownsBuffer =
        rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength;
      const outbound = ownsBuffer ? rgba : new Uint8Array(rgba);

      worker.postMessage(
        {
          id,
          filter: task.filter,
          payload: { ...task.payload, rgba: outbound },
        },
        [outbound.buffer],
      );
    }
  }

  private handleMessage(worker: Worker, response: WorkerResponse): void {
    const task = this.inflight.get(response.id);
    if (task === undefined) {
      return;
    }

    this.inflight.delete(response.id);
    if (task.worker === worker && !this.disposed) {
      this.idleWorkers.push(worker);
    }

    if (response.error !== undefined) {
      task.reject(new Error(response.error));
    } else if (response.result !== undefined) {
      task.resolve(response.result);
    } else {
      task.reject(new Error("Worker returned an empty response."));
    }

    this.drainQueue();
  }

  private rejectWorkerTasks(worker: Worker, message: string): void {
    for (const [id, task] of this.inflight.entries()) {
      if (task.worker === worker) {
        task.reject(new Error(message));
        this.inflight.delete(id);
      }
    }
    this.removeWorker(worker);
    if (this.workers.length === 0) {
      for (const task of this.pendingQueue.splice(0)) {
        task.reject(new Error("No tile workers are available."));
      }
    }
    this.drainQueue();
  }

  private removeWorker(worker: Worker): void {
    const workerIndex = this.workers.indexOf(worker);
    if (workerIndex >= 0) {
      this.workers.splice(workerIndex, 1);
    }
    const idleIndex = this.idleWorkers.indexOf(worker);
    if (idleIndex >= 0) {
      this.idleWorkers.splice(idleIndex, 1);
    }
    worker.terminate();
  }
}
