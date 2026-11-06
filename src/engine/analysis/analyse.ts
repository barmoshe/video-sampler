// Ingest analysis (design §4, §7): auto-root, onsets for Slice by Transient, loudness for pads.
import { PitchDetector } from 'pitchy'
import { filter, highPass, highShelf, power } from './dsp'

/**
 * Auto-root (spike test 9): pitchy's McLeod method picks the fundamental's neighbourhood (no
 * octave errors); when confident windows are scarce (percussive, inharmonic sounds) a long FFT
 * peak refines it. Spike: 10 / 10 clips within 20 cents; MPM alone read a thumb piano 43 c flat.
 */
export function autoRoot(x: Float32Array, fs: number): { midi: number; found: boolean } {
  const WIN = 4096, HOP = 1024
  const n = Math.min(x.length, Math.round(fs * 10))
  if (n < WIN) return { midi: 60, found: false }
  const det = PitchDetector.forFloat32Array(WIN)
  det.minVolumeDecibels = -45
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]))
  const pitches: number[] = []
  for (let i = 0; i + WIN <= n; i += HOP) {
    const w = x.subarray(i, i + WIN)
    let e = 0
    for (const v of w) e += v * v
    if (Math.sqrt(e / WIN) < 0.02 * peak) continue
    const [f, clarity] = det.findPitch(w, fs)
    if (clarity >= 0.9 && f > 30 && f < 2000) pitches.push(f)
  }
  if (pitches.length < 3) return { midi: 60, found: false }
  pitches.sort((a, b) => a - b)
  let hz = pitches[Math.floor(pitches.length / 2)]
  if (pitches.length < 30) { // percussive: refine with an FFT peak within ±60 cents
    let N = 1
    while (N < Math.min(n, 1 << 17)) N <<= 1
    const p = power(x, Math.floor(n * 0.05), N), bin = fs / N
    const lo = Math.max(1, Math.floor((hz * Math.pow(2, -0.6 / 12)) / bin)), hi = Math.ceil((hz * Math.pow(2, 0.6 / 12)) / bin)
    let k = lo
    for (let i = lo; i <= hi; i++) if (p[i] > p[k]) k = i
    const a = Math.log(p[k - 1] + 1e-20), b = Math.log(p[k] + 1e-20), c = Math.log(p[k + 1] + 1e-20)
    hz = (k + (0.5 * (a - c)) / (a - 2 * b + c)) * bin
  }
  return { midi: 69 + 12 * Math.log2(hz / 440), found: true }
}

/** Spectral-flux onsets (seconds), at least 60 ms apart: Slice by Transient. */
export function onsets(x: Float32Array, fs: number): number[] {
  const N = 1024, H = 256
  const frames = Math.floor((x.length - N) / H)
  if (frames < 3) return []
  // log-magnitude spectrogram (λ = 10; λ = 1000 lifted the noise floor to click level)
  const B = N / 2
  const mags = new Float32Array(frames * B)
  for (let f = 0; f < frames; f++) {
    const p = power(x, f * H, N)
    for (let b = 0; b < B; b++) mags[f * B + b] = Math.log1p(10 * Math.sqrt(p[b]))
  }
  // each bin's median over the clip is its steady floor (a held tone, codec hiss): flux counts only
  // what rises above it, so steady sound cancels and changes stand out
  const floor = new Float32Array(B), col = new Float32Array(frames)
  for (let b = 0; b < B; b++) {
    for (let f = 0; f < frames; f++) col[f] = mags[f * B + b]
    floor[b] = Float32Array.from(col).sort()[frames >> 1]
  }
  const flux = new Float64Array(frames)
  for (let f = 1; f < frames; f++) {
    let s = 0
    for (let b = 0; b < B; b++) {
      const now = Math.max(0, mags[f * B + b] - floor[b]), before = Math.max(0, mags[(f - 1) * B + b] - floor[b])
      if (now > before) s += now - before
    }
    flux[f] = s
  }
  // Robust peak picking: flux normalised (below), a local-median threshold + δ, a
  // local maximum over ±3 frames, 60 ms apart. (A mean-based threshold followed the codec's noise on
  // a steady tone: 198 "hits" for 30 clicks.)
  // normalise to the maximum: with sparse hits (10 clicks in 1,870 frames) a 99th percentile lands on
  // a noise frame and scales the noise up to 1
  let ref = 0
  for (const v of flux) ref = Math.max(ref, v)
  ref = ref || 1
  // ... and a hit must stand well clear of the clip's typical flux (else a bare tone's noise, scaled
  // to its own maximum, becomes "hits")
  const gate = (Float64Array.from(flux).sort()[frames >> 1] * 6) / ref
  const nf = flux.map((v) => v / ref)
  const out: number[] = []
  const W = 10, P = 3, delta = 0.15, minGap = Math.round((0.06 * fs) / H)
  let last = -minGap
  const win: number[] = []
  for (let f = 1; f < frames - 1; f++) {
    win.length = 0
    for (let k = Math.max(0, f - W); k <= Math.min(frames - 1, f + W); k++) win.push(nf[k])
    win.sort((a, b) => a - b)
    const thr = Math.max(win[win.length >> 1] + delta, gate)
    if (nf[f] <= thr || f - last < minGap) continue
    let peak = true
    for (let k = Math.max(0, f - P); k <= Math.min(frames - 1, f + P); k++) if (nf[k] > nf[f]) { peak = false; break }
    if (peak) { out.push((f * H + N / 2) / fs); last = f } // the window's centre
  }
  return out
}

/** Integrated loudness (LUFS), ITU-R BS.1770 shape: K-weighting, 400 ms blocks, two gates. */
export function loudness(channels: Float32Array[], fs: number): number {
  const shelf = highShelf(fs, 1681.97, 3.9998, 0.7072), hp = highPass(fs, 38.135, 0.5003)
  const kw = channels.map((c) => filter(filter(c, shelf), hp))
  const B = Math.round(0.4 * fs), step = Math.round(0.1 * fs)
  const blocks: number[] = []
  for (let s = 0; s + B <= kw[0].length; s += step) {
    let z = 0
    for (const c of kw) { let e = 0; for (let i = s; i < s + B; i++) e += c[i] * c[i]; z += e / B }
    blocks.push(z)
  }
  const L = (z: number) => -0.691 + 10 * Math.log10(z + 1e-12)
  const g1 = blocks.filter((z) => L(z) > -70)
  if (!g1.length) return -70
  const mean1 = g1.reduce((a, b) => a + b, 0) / g1.length
  const g2 = g1.filter((z) => L(z) > L(mean1) - 10)
  return L(g2.reduce((a, b) => a + b, 0) / Math.max(1, g2.length))
}

/** Scene cuts from per-frame picture differences: peaks well above the clip's own motion. */
export function cuts(diff: Float32Array, fps: number): number[] {
  const out: number[] = []
  const sorted = Array.from(diff).sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0
  const thr = Math.max(0.08, med * 4)
  let last = -Infinity
  for (let i = 1; i < diff.length; i++) {
    if (diff[i] > thr && diff[i] >= (diff[i - 1] ?? 0) && i - last > fps * 0.25) { out.push(i / fps); last = i }
  }
  return out
}
