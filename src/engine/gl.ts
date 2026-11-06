// WebGL2: the frame cache (texture arrays per clip, S and M tiers) and the collage renderer
// (design §4, §6; math §3 temporal filter). One instanced draw per clip tier.

export interface TexArray { tex: WebGLTexture; w: number; h: number; layers: number; bytes: number }

export function createGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance', antialias: false, alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: false })
  if (!gl) throw new Error('This browser has no WebGL2.')
  return gl
}

export function createArray(gl: WebGL2RenderingContext, w: number, h: number, layers: number): TexArray {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, layers)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const err = gl.getError()
  if (err) { gl.deleteTexture(tex); throw new Error(`Out of GPU memory for ${w}×${h}×${layers} (GL ${err}).`) }
  return { tex, w, h, layers, bytes: w * h * 4 * layers }
}

/** Tier sizes that keep the clip's aspect at about the spike's areas (S 192×108, M 480×270). */
export function tierSize(aspect: number, area: number): [number, number] {
  const w = Math.max(16, Math.round(Math.sqrt(area * aspect) / 4) * 4)
  return [w, Math.max(16, Math.round(w / aspect / 4) * 4)]
}

export interface ClipFrames { S: TexArray; M: TexArray | null; frames: number; fps: number; aspect: number; poster: number; rotation: 0 | 90 | 180 | 270 }

/** Per-clip texture arrays under one GPU budget (math §11). */
export class FrameCache {
  clips = new Map<string, ClipFrames>()
  budgetS = 420 * 2 ** 20
  budgetM = 560 * 2 ** 20
  readonly gl: WebGL2RenderingContext
  constructor(gl: WebGL2RenderingContext) { this.gl = gl }

  used(tier: 'S' | 'M') {
    let b = 0
    for (const c of this.clips.values()) b += tier === 'S' ? c.S.bytes : c.M?.bytes ?? 0
    return b
  }

  /** `aspect` and the tiers are in stored (coded) orientation; `rotation` turns them for display. */
  allocate(id: string, frames: number, fps: number, aspect: number, rotation: 0 | 90 | 180 | 270 = 0): ClipFrames {
    this.free(id)
    const maxLayers = this.gl.getParameter(this.gl.MAX_ARRAY_TEXTURE_LAYERS) as number
    const layers = Math.min(frames, maxLayers)
    // S always; shrink it if the clips together would pass the S budget
    let areaS = 192 * 108
    const needS = this.used('S') + areaS * 4 * layers
    if (needS > this.budgetS) areaS *= Math.max(0.2, (this.budgetS - this.used('S')) / (areaS * 4 * layers))
    const [sw, sh] = tierSize(aspect, areaS)
    const S = createArray(this.gl, sw, sh, layers)
    // M only while it fits its budget (spike: 445 MB per 30 s, so long clips stay S-only)
    const [mw, mh] = tierSize(aspect, 480 * 270)
    const M = this.used('M') + mw * mh * 4 * layers <= this.budgetM ? createArray(this.gl, mw, mh, layers) : null
    const c: ClipFrames = { S, M, frames: layers, fps, aspect, poster: Math.floor(layers / 2), rotation }
    this.clips.set(id, c)
    return c
  }

  upload(arr: TexArray, layer: number, src: TexImageSource) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, arr.tex)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, arr.w, arr.h, 1, gl.RGBA, gl.UNSIGNED_BYTE, src)
  }

  /** `count` layers from one tall image (frames stacked top to bottom): one call instead of `count`. */
  uploadStack(arr: TexArray, first: number, count: number, src: TexImageSource) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, arr.tex)
    gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, arr.h)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, first, arr.w, arr.h, count, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0)
  }

  /**
   * Tiny thumbnails of every layer (for scene cuts and the poster colour), blitted on the GPU 64 at
   * a time and read back once per batch. Reading back each frame during ingest stalled the GPU 900
   * times and made a 30 s clip take minutes.
   */
  thumbnails(arr: TexArray, tw = 32, th = 18): Uint8Array {
    const gl = this.gl, batch = 64
    const rb = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, tw, th * batch)
    const dst = gl.createFramebuffer(), src = gl.createFramebuffer()
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst)
    gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb)
    const out = new Uint8Array(arr.layers * tw * th * 4)
    for (let b = 0; b < arr.layers; b += batch) {
      const n = Math.min(batch, arr.layers - b)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst)
      for (let k = 0; k < n; k++) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src)
        gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, arr.tex, 0, b + k)
        gl.blitFramebuffer(0, 0, arr.w, arr.h, 0, k * th, tw, (k + 1) * th, gl.COLOR_BUFFER_BIT, gl.LINEAR)
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, dst)
      gl.readPixels(0, 0, tw, th * n, gl.RGBA, gl.UNSIGNED_BYTE, out.subarray(b * tw * th * 4, (b + n) * tw * th * 4))
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    gl.deleteFramebuffer(src); gl.deleteFramebuffer(dst); gl.deleteRenderbuffer(rb)
    return out
  }

  /** One cached frame, RGBA rows as uploaded (top row first), for UI thumbnails. */
  readLayer(arr: TexArray, layer: number): Uint8ClampedArray {
    const gl = this.gl, fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb)
    gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, arr.tex, 0, Math.max(0, Math.min(arr.layers - 1, layer)))
    const out = new Uint8ClampedArray(arr.w * arr.h * 4)
    gl.readPixels(0, 0, arr.w, arr.h, gl.RGBA, gl.UNSIGNED_BYTE, out)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.deleteFramebuffer(fb)
    return out
  }

  free(id: string) {
    const c = this.clips.get(id)
    if (!c) return
    this.gl.deleteTexture(c.S.tex)
    if (c.M) this.gl.deleteTexture(c.M.tex)
    this.clips.delete(id)
  }
}

const VS = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec4 rect;   // x, y, w, h in pixels, origin top-left
layout(location=2) in vec4 voice;  // q (source frame), W (shutter in frames), alpha, rotation (0..3 quarter turns clockwise)
layout(location=3) in vec4 crop;   // u0, v0, u1, v1, in display orientation
layout(location=4) in vec4 style;  // corner radius px, border px, -, -
layout(location=5) in vec4 fxIn;   // picture twins: blur (fraction of tile height), edge, glow, drive
uniform vec2 stage;
out vec2 uv; out vec2 lp; flat out vec3 s; flat out vec4 st; flat out vec4 fx;
void main() {
  vec2 p = rect.xy + corner * rect.zw;
  lp = corner * rect.zw; st = vec4(rect.zw, style.xy);
  gl_Position = vec4(p.x / stage.x * 2.0 - 1.0, 1.0 - p.y / stage.y * 2.0, 0.0, 1.0);
  vec2 d = mix(crop.xy, crop.zw, corner);           // display-space uv
  int r = int(voice.w + 0.5);                        // stored frame shown turned r quarter turns clockwise
  uv = r == 1 ? vec2(d.y, 1.0 - d.x) : r == 2 ? vec2(1.0 - d.x, 1.0 - d.y) : r == 3 ? vec2(1.0 - d.y, d.x) : d;
  s = voice.xyz; fx = fxIn;
}`

const FS = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray frames; uniform float count; uniform int maxTaps; uniform vec3 border;
in vec2 uv; in vec2 lp; flat in vec3 s; flat in vec4 st; flat in vec4 fx; out vec4 o;
float wrapLayer(float l) { return clamp(mod(l, count), 0.0, count - 1.0); }
float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  float q = s.x, W = s.y;
  vec3 c;
  if (W < 1.0) {                  // slow: blend the two neighbouring frames (math §3)
    float f0 = floor(q), t = q - f0;
    c = mix(texture(frames, vec3(uv, wrapLayer(f0))).rgb, texture(frames, vec3(uv, wrapLayer(f0 + 1.0))).rgb, t);
  } else {                        // fast: K evenly spaced taps under the shutter (box filter)
    int K = int(min(float(maxTaps), ceil(W)));
    c = vec3(0.0);
    for (int k = 0; k < 32; k++) {
      if (k >= K) break;
      c += texture(frames, vec3(uv, wrapLayer(floor(q - 0.5 * W + (float(k) + 0.5) * W / float(K))))).rgb;
    }
    c /= float(K);
  }
  // picture twins of the sound (design §5): blur, edges, glow, drive. Taps read the frame at q.
  if (fx.x > 0.0004 || fx.y > 0.001 || fx.z > 0.001) {
    float l = wrapLayer(floor(q + 0.5));
    vec2 ts = vec2(textureSize(frames, 0).xy);
    if (fx.x > 0.0004) {           // a 16-tap golden-angle disc: a soft lens blur
      vec2 rv = vec2(fx.x * ts.y / ts.x, fx.x);
      vec3 acc = c;
      for (int k = 1; k < 17; k++) {
        float r = sqrt(float(k) / 16.0), a = float(k) * 2.39996;
        acc += texture(frames, vec3(uv + rv * r * vec2(cos(a), sin(a)), l)).rgb;
      }
      c = acc / 17.0;
    }
    if (fx.y > 0.001 || fx.z > 0.001) { // edges by a Laplacian, 1.5 texels out
      vec2 e = 1.5 / ts;
      vec3 n = texture(frames, vec3(uv + vec2(0.0, e.y), l)).rgb, so = texture(frames, vec3(uv - vec2(0.0, e.y), l)).rgb;
      vec3 ea = texture(frames, vec3(uv + vec2(e.x, 0.0), l)).rgb, we = texture(frames, vec3(uv - vec2(e.x, 0.0), l)).rgb;
      vec3 lap = abs(4.0 * c - n - so - ea - we);
      c = mix(c, min(vec3(1.0), lap * 2.5 + c * 0.12), fx.y);
      c += fx.z * lap * 1.5;
    }
  }
  if (fx.w > 0.001) {              // drive: contrast and saturation
    float d = fx.w;
    c = clamp((c - 0.5) * (1.0 + 0.9 * d) + 0.5, 0.0, 1.0);
    float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = clamp(mix(vec3(y), c, 1.0 + 0.9 * d), 0.0, 1.0);
  }
  // the tile's frame (production.md §3 A): rounded corners, an optional border, antialiased
  vec2 hs = st.xy * 0.5;
  float d = sdRound(lp - hs, hs, min(st.z, min(hs.x, hs.y)));
  if (st.w > 0.0) c = mix(c, border, clamp(d + st.w + 0.5, 0.0, 1.0));
  float a = s.z * clamp(0.5 - d, 0.0, 1.0);
  o = vec4(c * a, a);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
  return sh
}

export interface Tile { x: number; y: number; w: number; h: number; q: number; W: number; alpha: number; crop: [number, number, number, number]; rot?: number; radius?: number; border?: number; fx?: [number, number, number, number] }
export type Blend = 'normal' | 'screen' | 'add'

const STRIDE = 20
const NO_FX: [number, number, number, number] = [0, 0, 0, 0]

export class Collage {
  private p: WebGLProgram
  private vao: WebGLVertexArrayObject
  private ib: WebGLBuffer
  private inst: Float32Array
  private u: Record<string, WebGLUniformLocation | null>

  readonly gl: WebGL2RenderingContext
  readonly max: number

  constructor(gl: WebGL2RenderingContext, max = 512) {
    this.gl = gl
    this.max = max
    const p = gl.createProgram()!
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS))
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    this.p = p
    this.u = Object.fromEntries(['stage', 'frames', 'count', 'maxTaps', 'border'].map((n) => [n, gl.getUniformLocation(p, n)]))
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const cb = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, cb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.inst = new Float32Array(max * STRIDE)
    this.ib = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ib)
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW)
    for (const [loc, off] of [[1, 0], [2, 16], [3, 32], [4, 48], [5, 64]] as const) {
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, STRIDE * 4, off)
      gl.vertexAttribDivisor(loc, 1)
    }
    gl.bindVertexArray(null)
  }

  clear(width: number, height: number, rgb: [number, number, number] = [0.04, 0.04, 0.05]) {
    const gl = this.gl
    gl.viewport(0, 0, width, height)
    gl.clearColor(rgb[0], rgb[1], rgb[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  draw(arr: TexArray, tiles: Tile[], width: number, height: number, blend: Blend = 'normal', maxTaps = 8, borderRGB: [number, number, number] = [0.95, 0.94, 0.9]) {
    const gl = this.gl, n = Math.min(tiles.length, this.max)
    if (!n) return
    for (let i = 0; i < n; i++) {
      const t = tiles[i], o = i * STRIDE
      this.inst.set([t.x, t.y, t.w, t.h, t.q, t.W, t.alpha, t.rot ?? 0, ...t.crop, t.radius ?? 0, t.border ?? 0, 0, 0, ...(t.fx ?? NO_FX)], o)
    }
    gl.viewport(0, 0, width, height)
    gl.enable(gl.BLEND)
    if (blend === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR)
    else if (blend === 'add') gl.blendFunc(gl.ONE, gl.ONE)
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(this.p)
    gl.uniform2f(this.u.stage, width, height)
    gl.uniform1f(this.u.count, arr.layers)
    gl.uniform1i(this.u.maxTaps, maxTaps)
    gl.uniform3f(this.u.border, borderRGB[0], borderRGB[1], borderRGB[2])
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, arr.tex)
    gl.uniform1i(this.u.frames, 0)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ib)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst, 0, n * STRIDE)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n)
    gl.bindVertexArray(null)
  }
}

/** Fill: crop the clip (aspect a) to a cell (aspect c), centred. */
export function fillCrop(clipAspect: number, cellAspect: number): [number, number, number, number] {
  if (clipAspect > cellAspect) { const u = cellAspect / clipAspect; return [(1 - u) / 2, 0, (1 + u) / 2, 1] }
  const v = clipAspect / cellAspect
  return [0, (1 - v) / 2, 1, (1 + v) / 2]
}
