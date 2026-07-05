import { PhantomError, assertPositiveInteger } from "./types.js";

/**
 * A size-bucketed buffer pool that eliminates per-tile allocation overhead.
 *
 * Instead of allocating new Uint8Array buffers for every tile (which triggers GC
 * on large images with thousands of tiles), this pool recycles buffers by size bucket.
 *
 * Buckets are power-of-two aligned so that tiles with slightly different sizes
 * (due to edge clamping) still share the same pool bucket.
 *
 * Usage pattern:
 *   const pool = new TileBufferPool();
 *   const buf = pool.acquire(neededBytes);
 *   // ... use buf.subarray(0, neededBytes) ...
 *   pool.release(buf);
 */
export class TileBufferPool {
  private readonly buckets = new Map<number, Uint8Array[]>();
  private readonly maxPerBucket: number;
  private acquiredCount = 0;
  private releasedCount = 0;

  public constructor(maxPerBucket = 8) {
    if (maxPerBucket < 1) {
      throw new PhantomError("maxPerBucket must be at least 1.");
    }
    this.maxPerBucket = maxPerBucket;
  }

  /**
   * Acquires a buffer of at least `byteLength` bytes.
   * The returned buffer may be larger than requested — always use
   * `.subarray(0, byteLength)` for the actual working range.
   */
  public acquire(byteLength: number): Uint8Array {
    assertPositiveInteger(byteLength, "byteLength");
    const bucketSize = nextPowerOfTwo(byteLength);
    const bucket = this.buckets.get(bucketSize);

    this.acquiredCount += 1;

    if (bucket !== undefined && bucket.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return bucket.pop()!;
    }

    return new Uint8Array(bucketSize);
  }

  /**
   * Returns a buffer to the pool for reuse.
   * The buffer's contents are NOT cleared — callers must handle initialization.
   */
  public release(buffer: Uint8Array): void {
    const bucketSize = buffer.length;
    // Only pool power-of-two sized buffers (rejects mismatched buffers gracefully)
    if ((bucketSize & (bucketSize - 1)) !== 0) {
      return; // Not a power-of-two — was not from this pool, ignore
    }

    let bucket = this.buckets.get(bucketSize);
    if (bucket === undefined) {
      bucket = [];
      this.buckets.set(bucketSize, bucket);
    }

    if (bucket.length < this.maxPerBucket) {
      bucket.push(buffer);
    }
    // If bucket is full, let the buffer be GC'd

    this.releasedCount += 1;
  }

  /**
   * Returns pool statistics for monitoring memory pressure.
   */
  public get stats(): TileBufferPoolStats {
    let pooledBuffers = 0;
    let pooledBytes = 0;
    for (const [size, bucket] of this.buckets) {
      pooledBuffers += bucket.length;
      pooledBytes += bucket.length * size;
    }

    return {
      acquiredCount: this.acquiredCount,
      releasedCount: this.releasedCount,
      pooledBuffers,
      pooledBytes,
      bucketCount: this.buckets.size,
    };
  }

  /**
   * Releases all pooled buffers to GC. Useful after processing is complete.
   */
  public drain(): void {
    this.buckets.clear();
  }
}

export interface TileBufferPoolStats {
  readonly acquiredCount: number;
  readonly releasedCount: number;
  readonly pooledBuffers: number;
  readonly pooledBytes: number;
  readonly bucketCount: number;
}

/**
 * Rounds up to the next power of two. For values already a power of two,
 * returns the same value.
 */
function nextPowerOfTwo(value: number): number {
  if (value <= 0) return 1;
  // Bit-twiddling to find next power of two
  let v = value - 1;
  v |= v >>> 1;
  v |= v >>> 2;
  v |= v >>> 4;
  v |= v >>> 8;
  v |= v >>> 16;
  return v + 1;
}
