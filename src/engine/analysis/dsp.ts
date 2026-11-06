// Small DSP helpers for ingest analysis: FFT, power spectrum, biquads.

/** In-place iterative radix-2 FFT on (re, im) of length 2^k. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2
        const br = re[b] * cr - im[b] * ci, bi = re[b] * ci + im[b] * cr
        re[b] = re[a] - br; im[b] = im[a] - bi
        re[a] += br; im[a] += bi
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}

/** Hann-windowed power spectrum of x[offset .. offset+N), N = 2^k. */
export function power(x: Float32Array, offset: number, N: number): Float64Array {
  const re = new Float64Array(N), im = new Float64Array(N)
  for (let i = 0; i < N; i++) re[i] = (x[offset + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)))
  fft(re, im)
  const p = new Float64Array(N / 2)
  for (let i = 0; i < N / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i]
  return p
}

export function mono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length
  return out
}

export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** RBJ cookbook high shelf and high pass, used for BS.1770 K-weighting at any sample rate. */
export function highShelf(fs: number, f0: number, gainDb: number, q: number): Biquad {
  const A = Math.pow(10, gainDb / 40), w = (2 * Math.PI * f0) / fs, al = Math.sin(w) / (2 * q), c = Math.cos(w), s = 2 * Math.sqrt(A) * al
  const a0 = A + 1 - (A - 1) * c + s
  return {
    b0: (A * (A + 1 + (A - 1) * c + s)) / a0, b1: (-2 * A * (A - 1 + (A + 1) * c)) / a0, b2: (A * (A + 1 + (A - 1) * c - s)) / a0,
    a1: (2 * (A - 1 - (A + 1) * c)) / a0, a2: (A + 1 - (A - 1) * c - s) / a0,
  }
}
export function highPass(fs: number, f0: number, q: number): Biquad {
  const w = (2 * Math.PI * f0) / fs, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al
  return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 }
}
export function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v
  }
  return y
}
