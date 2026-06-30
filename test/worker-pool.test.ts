import { afterEach, describe, expect, it, vi } from "vitest";
import { TileWorkerPool } from "../src/workers/index.js";
import type { TilePayload, TileResult } from "../src/index.js";

interface PostedWorkerMessage {
  readonly id: number;
  readonly payload: TilePayload;
}

class MockWorker {
  public static instances: MockWorker[] = [];
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public posted: PostedWorkerMessage | undefined;
  public terminated = false;

  public constructor(
    public readonly url: string | URL,
    public readonly options: WorkerOptions,
  ) {
    MockWorker.instances.push(this);
  }

  public postMessage(message: PostedWorkerMessage): void {
    this.posted = message;
  }

  public terminate(): void {
    this.terminated = true;
  }
}

describe("TileWorkerPool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockWorker.instances = [];
  });

  it("rejects only the task assigned to a failed worker", async () => {
    vi.stubGlobal("Worker", MockWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 2 });

    const pool = new TileWorkerPool(new URL("file:///tile-worker.js"));
    const first = pool.runTile(createPayload(0), "identity");
    const second = pool.runTile(createPayload(1), "invert");

    const failedWorker = MockWorker.instances.find(
      (worker) => worker.posted?.payload.descriptor.index === 0,
    );
    const healthyWorker = MockWorker.instances.find(
      (worker) => worker.posted?.payload.descriptor.index === 1,
    );
    expect(failedWorker).toBeDefined();
    expect(healthyWorker).toBeDefined();

    const failedExpectation = expect(first).rejects.toThrow("worker failed");
    const healthyExpectation = expect(second).resolves.toEqual(
      createResult(createPayload(1)),
    );

    failedWorker?.onerror?.({ message: "worker failed" } as ErrorEvent);
    healthyWorker?.onmessage?.(
      new MessageEvent("message", {
        data: {
          id: healthyWorker.posted?.id,
          result: createResult(healthyWorker.posted?.payload),
        },
      }),
    );

    await failedExpectation;
    await healthyExpectation;
    expect(failedWorker?.terminated).toBe(true);
    pool.dispose();
  });
});

function createPayload(index: number): TilePayload {
  return {
    descriptor: {
      index,
      input: { x: 0, y: 0, width: 1, height: 1 },
      output: { x: 0, y: 0, width: 1, height: 1 },
    },
    rgba: new Uint8Array([index, 0, 0, 255]),
  };
}

function createResult(payload: TilePayload | undefined): TileResult {
  if (payload === undefined) {
    throw new Error("Missing posted payload.");
  }
  return {
    descriptor: payload.descriptor,
    rgba: new Uint8Array(payload.rgba),
  };
}
