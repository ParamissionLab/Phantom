import { PhantomError } from "../core/types.js";

export interface SharedTileBufferOptions {
  readonly preferShared?: boolean;
  readonly requireShared?: boolean;
}

/**
 * Allocates tile memory with SharedArrayBuffer when the runtime supports it.
 */
export class SharedTileBuffer {
  public readonly buffer: ArrayBuffer | SharedArrayBuffer;
  public readonly bytes: Uint8Array;
  public readonly shared: boolean;

  public constructor(
    byteLength: number,
    options: SharedTileBufferOptions = {},
  ) {
    if (!Number.isInteger(byteLength) || byteLength <= 0) {
      throw new PhantomError("byteLength must be a positive integer.");
    }

    const preferShared = options.preferShared ?? true;
    const canShare = typeof SharedArrayBuffer !== "undefined";

    if (options.requireShared === true && !canShare) {
      throw new PhantomError(
        "SharedArrayBuffer is not available in this runtime.",
      );
    }

    this.shared = preferShared && canShare;
    this.buffer = this.shared
      ? new SharedArrayBuffer(byteLength)
      : new ArrayBuffer(byteLength);
    this.bytes = new Uint8Array(this.buffer);
  }

  public view(offset = 0, length = this.bytes.byteLength - offset): Uint8Array {
    if (offset < 0 || length < 0 || offset + length > this.bytes.byteLength) {
      throw new PhantomError("SharedTileBuffer view is outside buffer bounds.");
    }
    return new Uint8Array(this.buffer, offset, length);
  }
}
