import {
  PhantomError,
  RGBA_CHANNELS,
  type ImageDimensions,
} from "../core/types.js";

/**
 * WebGL texture renderer for environments where WebGPU is unavailable.
 */
export class WebGlRgbaRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly texture: WebGLTexture;

  public constructor(
    canvas: HTMLCanvasElement,
    private readonly dimensions: ImageDimensions,
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
    });
    if (gl === null) {
      throw new PhantomError("WebGL2 is not available in this browser.");
    }

    const texture = gl.createTexture();
    if (texture === null) {
      throw new PhantomError("Unable to allocate WebGL texture.");
    }

    this.gl = gl;
    this.texture = texture;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MIN_FILTER,
      this.gl.LINEAR,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MAG_FILTER,
      this.gl.LINEAR,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_S,
      this.gl.CLAMP_TO_EDGE,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_T,
      this.gl.CLAMP_TO_EDGE,
    );
  }

  public upload(rgba: Uint8Array): void {
    const expected =
      this.dimensions.width * this.dimensions.height * RGBA_CHANNELS;
    if (rgba.length !== expected) {
      throw new PhantomError(
        `RGBA buffer length mismatch: expected ${expected}, got ${rgba.length}.`,
      );
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.dimensions.width,
      this.dimensions.height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      rgba,
    );
  }
}
