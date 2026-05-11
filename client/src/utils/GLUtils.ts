/* eslint-disable @typescript-eslint/no-explicit-any */
// WebGL2 多通道渲染器（移植自 liquid-glass-studio）。
type GL = WebGL2RenderingContext;

interface ShaderSource {
  vertex: string;
  fragment: string;
}

interface AttributeInfo {
  location: number;
  size: number;
  type: number;
}

interface UniformInfo {
  location: WebGLUniformLocation;
  type: number;
  value: any;
  isArray: false | { size: number };
}

interface RenderPassConfig {
  name: string;
  shader: ShaderSource;
  inputs?: { [uniformName: string]: string };
  outputToScreen?: boolean;
}

export class ShaderProgram {
  private gl: GL;
  private program: WebGLProgram;
  private uniforms: Map<string, UniformInfo> = new Map();
  private attributes: Map<string, AttributeInfo> = new Map();

  constructor(gl: GL, source: ShaderSource) {
    this.gl = gl;
    this.program = this.createProgram(source);
    this.detectAttributes();
    this.detectUniforms();
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${info}`);
    }
    return shader;
  }

  private createProgram(source: ShaderSource): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create program");
    const vs = this.createShader(gl.VERTEX_SHADER, source.vertex);
    const fs = this.createShader(gl.FRAGMENT_SHADER, source.fragment);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link error: ${info}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }

  private detectAttributes(): void {
    const gl = this.gl;
    const n = gl.getProgramParameter(this.program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveAttrib(this.program, i);
      if (!info) continue;
      const location = gl.getAttribLocation(this.program, info.name);
      this.attributes.set(info.name, { location, size: info.size, type: info.type });
    }
  }

  private detectUniforms(): void {
    const gl = this.gl;
    const n = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(this.program, i);
      if (!info) continue;
      const location = gl.getUniformLocation(this.program, info.name);
      if (!location) continue;
      const arrayRegex = /\[\d+\]$/;
      if (arrayRegex.test(info.name)) {
        const baseName = info.name.replace(arrayRegex, "");
        this.uniforms.set(baseName, {
          location,
          type: info.type,
          value: null,
          isArray: { size: info.size },
        });
      } else {
        this.uniforms.set(info.name, { location, type: info.type, value: null, isArray: false });
      }
    }
  }

  public use(): void {
    this.gl.useProgram(this.program);
  }

  public setUniform(name: string, value: any): void {
    const gl = this.gl;
    const u = this.uniforms.get(name);
    if (!u) return;
    const loc = u.location;
    if (u.isArray && Array.isArray(value)) {
      switch (u.type) {
        case gl.FLOAT: gl.uniform1fv(loc, value); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(loc, value); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(loc, value); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(loc, value); break;
      }
    } else {
      switch (u.type) {
        case gl.FLOAT: gl.uniform1f(loc, value); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(loc, value); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(loc, value); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(loc, value); break;
        case gl.INT: gl.uniform1i(loc, value); break;
        case gl.SAMPLER_2D: gl.uniform1i(loc, value); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(loc, false, value); break;
        case gl.FLOAT_MAT4: gl.uniformMatrix4fv(loc, false, value); break;
      }
    }
  }

  public getAttributeLocation(name: string): number {
    const a = this.attributes.get(name);
    return a ? a.location : -1;
  }

  public dispose(): void {
    const gl = this.gl;
    if (this.program) {
      const shaders = gl.getAttachedShaders(this.program);
      if (shaders) shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteProgram(this.program);
    }
    this.uniforms.clear();
    this.attributes.clear();
  }
}

export class FrameBuffer {
  private gl: GL;
  private fbo: WebGLFramebuffer;
  private texture: WebGLTexture;
  private depthTexture: WebGLTexture;
  private width: number;
  private height: number;

  constructor(gl: GL, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    const { fbo, texture, depthTexture } = this.createFramebuffer();
    this.fbo = fbo;
    this.texture = texture;
    this.depthTexture = depthTexture;
  }

  private createFramebuffer() {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error("Failed to create framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.width, this.height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const depthTexture = gl.createTexture();
    if (!depthTexture) throw new Error("Failed to create depth texture");
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.width, this.height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete: ${status}`);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { fbo, texture, depthTexture };
  }

  public bind(): void { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo); }
  public unbind(): void { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null); }
  public getTexture(): WebGLTexture { return this.texture; }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA16F, width, height, 0, this.gl.RGBA, this.gl.FLOAT, null);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.depthTexture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.DEPTH_COMPONENT24, width, height, 0, this.gl.DEPTH_COMPONENT, this.gl.UNSIGNED_INT, null);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  public dispose(): void {
    const gl = this.gl;
    gl.deleteFramebuffer(this.fbo);
    gl.deleteTexture(this.texture);
    gl.deleteTexture(this.depthTexture);
  }
}

export class RenderPass {
  private gl: GL;
  private program: ShaderProgram;
  private frameBuffer: FrameBuffer | null;
  private vao: WebGLVertexArrayObject;
  public config: RenderPassConfig;

  constructor(gl: GL, shaderSource: ShaderSource, outputToScreen: boolean = false) {
    this.gl = gl;
    this.config = { name: "", shader: shaderSource };
    this.program = new ShaderProgram(gl, shaderSource);
    this.frameBuffer = !outputToScreen
      ? new FrameBuffer(gl, gl.canvas.width, gl.canvas.height)
      : null;
    this.vao = this.createVAO();
  }

  private createVAO(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create VAO");
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Failed to create buffer");
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const positionLoc = this.program.getAttributeLocation("a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return vao;
  }

  public setConfig(config: RenderPassConfig) { this.config = config; }

  public render(uniforms?: Record<string, any>): void {
    const gl = this.gl;
    if (this.frameBuffer) this.frameBuffer.bind();
    else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.program.use();
    if (uniforms) {
      let textureCount = 0;
      Object.entries(uniforms).forEach(([name, value]) => {
        if (value instanceof WebGLTexture) {
          gl.activeTexture(gl.TEXTURE0 + textureCount);
          gl.bindTexture(gl.TEXTURE_2D, value);
          this.program.setUniform(name, textureCount);
          textureCount += 1;
        } else {
          this.program.setUniform(name, value);
        }
      });
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    if (this.frameBuffer) this.frameBuffer.unbind();
  }

  public getOutputTexture(): WebGLTexture | null {
    return this.frameBuffer ? this.frameBuffer.getTexture() : null;
  }

  public resize(width: number, height: number): void {
    if (this.frameBuffer) this.frameBuffer.resize(width, height);
  }

  public dispose(): void {
    if (this.frameBuffer) this.frameBuffer.dispose();
    this.program.dispose();
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
  }
}

export class MultiPassRenderer {
  private gl: GL;
  private passes: Map<string, RenderPass> = new Map();
  private passesArray: RenderPass[] = [];
  private globalUniforms: Record<string, any> = {};

  constructor(canvas: HTMLCanvasElement, configs: RenderPassConfig[]) {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 not supported");
    const ext = gl.getExtension("EXT_color_buffer_float");
    if (!ext) throw new Error("EXT_color_buffer_float not supported");
    this.gl = gl;
    const arr: typeof this.passesArray = [];
    for (const [i, cfg] of configs.entries()) {
      const pass = new RenderPass(gl, cfg.shader, cfg.outputToScreen);
      pass.setConfig(cfg);
      this.passes.set(cfg.name, pass);
      arr[i] = pass;
    }
    this.passesArray = arr;
  }

  public resize(width: number, height: number): void {
    this.passesArray.forEach((p) => p.resize(width, height));
  }

  public setUniform(name: string, value: any): void { this.globalUniforms[name] = value; }
  public setUniforms(uniforms: Record<string, any>): void { Object.assign(this.globalUniforms, uniforms); }

  public render(passUniforms?: Record<string, Record<string, any>>): void {
    this.passesArray.forEach((pass) => {
      const uniforms: Record<string, any> = { ...this.globalUniforms };
      if (passUniforms) Object.assign(uniforms, passUniforms[pass.config.name] ?? null);
      if (pass.config.inputs) {
        Object.entries(pass.config.inputs).forEach(([uName, fromName]) => {
          const fromPass = this.passes.get(fromName);
          uniforms[uName] = fromPass?.getOutputTexture();
        });
      }
      pass.render(uniforms);
    });
  }

  public dispose(): void {
    const gl = this.gl;
    this.passes.forEach((p) => p.dispose());
    this.passes.clear();
    this.globalUniforms = {};
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}

export function computeGaussianKernelByRadius(radius: number): number[] {
  const sigma = radius / 3.0;
  const kernel: number[] = [];
  let sum = 0;
  for (let i = 0; i <= radius; i++) {
    const w = Math.exp((-0.5 * (i * i)) / (sigma * sigma));
    kernel.push(w);
    sum += i === 0 ? w : w * 2;
  }
  return kernel.map((w) => w / sum);
}
