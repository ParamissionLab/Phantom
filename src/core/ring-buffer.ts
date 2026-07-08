import { PhantomError, assertPositiveInteger } from "./types.js";

const DEFAULT_CAPACITY_BYTES = 64 * 1024 * 1024;

/**
 * Fixed-capacity byte ring buffer for stream ingestion.
 *
 * Optimized for maximum throughput:
 * - Power-of-two capacity enables bitwise AND masking instead of modulo
 * - Bulk Uint8Array.set operations for memcpy-speed transfers
 * - Minimized branch count in hot path
 *
 * The buffer never grows after construction. Callers decide whether to apply
 * backpressure, drop data, or fail when `availableWrite` is exhausted.
 */
export class FixedByteRingBuffer {
  private readonly buffer: Uint8Array;
  private readonly mask: number; // capacity - 1 for bitwise wrap
  private readOffset = 0;
  private writeOffset = 0;
  private storedBytes = 0;

  public constructor(capacityBytes = DEFAULT_CAPACITY_BYTES) {
    assertPositiveInteger(capacityBytes, "capacityBytes");
    // Round up to next power of two for bitwise masking
    const capacity = nextPow2(capacityBytes);
    this.buffer = new Uint8Array(capacity);
    this.mask = capacity - 1;
  }

  public get capacity(): number {
    return this.buffer.length;
  }

  public get availableRead(): number {
    return this.storedBytes;
  }

  public get availableWrite(): number {
    return this.buffer.length - this.storedBytes;
  }

  public clear(): void {
    this.readOffset = 0;
    this.writeOffset = 0;
    this.storedBytes = 0;
  }

  public write(source: Uint8Array): number {
    const writable = Math.min(source.length, this.availableWrite);
    if (writable === 0) {
      return 0;
    }

    this.bulkCopyIn(source, writable);
    this.storedBytes += writable;
    return writable;
  }

  public writeOrThrow(source: Uint8Array): void {
    if (source.length > this.availableWrite) {
      throw new PhantomError(
        `Ring buffer overflow: need ${source.length} bytes but only ${this.availableWrite} available in ${this.buffer.length} byte buffer.`,
      );
    }
    this.bulkCopyIn(source, source.length);
    this.storedBytes += source.length;
  }

  public read(target: Uint8Array): number {
    const readable = Math.min(target.length, this.availableRead);
    if (readable === 0) {
      return 0;
    }

    this.bulkCopyOut(target, readable);
    this.storedBytes -= readable;
    return readable;
  }

  /**
   * Bulk copy into ring buffer — uses at most 2 set() calls (one per wrap).
   * V8 optimizes Uint8Array.set to memcpy for non-overlapping regions.
   */
  private bulkCopyIn(source: Uint8Array, length: number): void {
    const cap = this.buffer.length;
    const firstChunk = cap - this.writeOffset;

    if (length <= firstChunk) {
      // No wrap — single copy
      this.buffer.set(source.subarray(0, length), this.writeOffset);
      this.writeOffset = (this.writeOffset + length) & this.mask;
    } else {
      // Wrap — two copies
      this.buffer.set(source.subarray(0, firstChunk), this.writeOffset);
      const remaining = length - firstChunk;
      this.buffer.set(source.subarray(firstChunk, firstChunk + remaining), 0);
      this.writeOffset = remaining;
    }
  }

  /**
   * Bulk copy out of ring buffer — uses at most 2 set() calls.
   */
  private bulkCopyOut(target: Uint8Array, length: number): void {
    const cap = this.buffer.length;
    const firstChunk = cap - this.readOffset;

    if (length <= firstChunk) {
      // No wrap — single copy
      target.set(this.buffer.subarray(this.readOffset, this.readOffset + length));
      this.readOffset = (this.readOffset + length) & this.mask;
    } else {
      // Wrap — two copies
      target.set(this.buffer.subarray(this.readOffset, this.readOffset + firstChunk));
      const remaining = length - firstChunk;
      target.set(this.buffer.subarray(0, remaining), firstChunk);
      this.readOffset = remaining;
    }
  }
}

/**
 * Pipes async/sync chunks through a bounded ring buffer, calling `onChunk`
 * with each batch of readable bytes. Keeps ingestion at a fixed memory footprint
 * even for large sources.
 */
export async function pipeChunksToBuffer(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  onChunk: (chunk: Uint8Array) => Promise<void> | void,
  capacityBytes = DEFAULT_CAPACITY_BYTES,
  signal?: AbortSignal,
): Promise<number> {
  const ring = new FixedByteRingBuffer(capacityBytes);
  let totalBytes = 0;

  // Pre-allocate drain buffer to avoid per-chunk allocation
  const drainBuffer = new Uint8Array(ring.capacity);

  for await (const chunk of chunks) {
    signal?.throwIfAborted();
    if (chunk.length > ring.capacity) {
      throw new PhantomError(
        `Input chunk (${chunk.length} bytes) is larger than fixed buffer capacity (${ring.capacity} bytes).`,
      );
    }

    ring.writeOrThrow(chunk);
    const readable = ring.availableRead;
    const read = ring.read(drainBuffer.subarray(0, readable));
    totalBytes += read;
    await onChunk(drainBuffer.subarray(0, read));
  }

  return totalBytes;
}

function nextPow2(value: number): number {
  if (value <= 1) return 1;
  let v = value - 1;
  v |= v >>> 1;
  v |= v >>> 2;
  v |= v >>> 4;
  v |= v >>> 8;
  v |= v >>> 16;
  return v + 1;
}
