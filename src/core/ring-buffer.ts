import { PhantomError, assertPositiveInteger } from "./types.js";

const DEFAULT_CAPACITY_BYTES = 64 * 1024 * 1024;

/**
 * Fixed-capacity byte ring buffer for stream ingestion.
 *
 * The buffer never grows after construction. Callers decide whether to apply
 * backpressure, drop data, or fail when `availableWrite` is exhausted.
 */
export class FixedByteRingBuffer {
  private readonly buffer: Uint8Array;
  private readOffset = 0;
  private writeOffset = 0;
  private storedBytes = 0;

  public constructor(capacityBytes = DEFAULT_CAPACITY_BYTES) {
    assertPositiveInteger(capacityBytes, "capacityBytes");
    this.buffer = new Uint8Array(capacityBytes);
  }

  public get capacity(): number {
    return this.buffer.length;
  }

  public get availableRead(): number {
    return this.storedBytes;
  }

  public get availableWrite(): number {
    return this.capacity - this.storedBytes;
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

    this.copyIntoBuffer(source, writable);
    this.storedBytes += writable;
    return writable;
  }

  public writeOrThrow(source: Uint8Array): void {
    const written = this.write(source);
    if (written !== source.length) {
      throw new PhantomError(
        `Ring buffer overflow: wrote ${written} of ${source.length} bytes into ${this.capacity} byte buffer.`,
      );
    }
  }

  public read(target: Uint8Array): number {
    const readable = Math.min(target.length, this.availableRead);
    if (readable === 0) {
      return 0;
    }

    this.copyFromBuffer(target, readable);
    this.storedBytes -= readable;
    return readable;
  }

  private copyIntoBuffer(source: Uint8Array, length: number): void {
    let copied = 0;
    while (copied < length) {
      const chunkLength = Math.min(
        length - copied,
        this.capacity - this.writeOffset,
      );
      this.buffer.set(
        source.subarray(copied, copied + chunkLength),
        this.writeOffset,
      );
      this.writeOffset = (this.writeOffset + chunkLength) % this.capacity;
      copied += chunkLength;
    }
  }

  private copyFromBuffer(target: Uint8Array, length: number): void {
    let copied = 0;
    while (copied < length) {
      const chunkLength = Math.min(
        length - copied,
        this.capacity - this.readOffset,
      );
      target.set(
        this.buffer.subarray(this.readOffset, this.readOffset + chunkLength),
        copied,
      );
      this.readOffset = (this.readOffset + chunkLength) % this.capacity;
      copied += chunkLength;
    }
  }
}

/**
 * Streams chunks through a bounded ring buffer and invokes `onChunk` with the
 * readable bytes. This keeps ingestion capacity fixed even for large sources.
 */
export async function streamChunksToFixedBuffer(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  onChunk: (chunk: Uint8Array) => Promise<void> | void,
  capacityBytes = DEFAULT_CAPACITY_BYTES,
  signal?: AbortSignal,
): Promise<number> {
  const ring = new FixedByteRingBuffer(capacityBytes);
  let totalBytes = 0;

  for await (const chunk of chunks) {
    signal?.throwIfAborted();
    if (chunk.length > ring.capacity) {
      throw new PhantomError(
        `Input chunk (${chunk.length} bytes) is larger than fixed buffer capacity (${ring.capacity} bytes).`,
      );
    }

    ring.writeOrThrow(chunk);
    const readable = new Uint8Array(ring.availableRead);
    const read = ring.read(readable);
    totalBytes += read;
    await onChunk(readable.subarray(0, read));
  }

  return totalBytes;
}
