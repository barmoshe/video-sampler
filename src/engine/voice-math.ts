// Shared by the voice-engine worklet, the live picture and the offline export, so all three
// compute the same numbers. Formulas: bar_builds lab/video-sampler/math.md (§1 rate, §6
// velocity and envelopes, §8 crossfades, §9 pyramid level).

export const ROOT = 60 // C3, Ableton naming

export interface Env { a: number; d: number; s: number; r: number }
export const DEFAULT_ENV: Env = { a: 0.005, d: 0.3, s: 0.8, r: 0.4 }

/** math §1: playback rate for a note. */
export function rate(note: number, root = ROOT, transpose = 0, cents = 0): number {
  return Math.pow(2, (note - root + transpose) / 12 + cents / 1200)
}

/** math §6: Dannenberg velocity → peak amplitude over a dynamic range of R dB. */
export function velocityGain(v: number, R = 40): number {
  const r = Math.pow(10, R / 20)
  const b = 127 / (126 * Math.sqrt(r)) - 1 / 126
  const m = (1 - b) / 127
  const a = m * Math.max(1, Math.min(127, v)) + b
  return a * a
}

/** math §6: ADSR level t seconds after note-on, released at `off` (Infinity while held). */
export function envelope(t: number, off: number, env: Env = DEFAULT_ENV): number {
  const held = (u: number) => {
    if (u < 0) return 0
    const a = Math.max(0.0015, env.a)
    if (u < a) return u / a
    const tauD = Math.max(1e-4, env.d) / Math.log(1000)
    return env.s + (1 - env.s) * Math.exp(-(u - a) / tauD)
  }
  if (t < off) return held(t)
  const tauR = Math.max(0.03, env.r) / Math.log(1000)
  return held(off) * Math.exp(-(t - off) / tauR)
}

/** Seconds after release until the envelope is under −60 dB. */
export function releaseTail(env: Env = DEFAULT_ENV): number {
  return Math.max(0.03, env.r)
}

/** math §9: pyramid level for a step (level-0 samples per output sample). */
export function pyramidLevel(step: number, levels: number): number {
  if (step <= 1) return 0
  return Math.min(levels - 1, Math.ceil(Math.log2(step) - 1e-9))
}

export interface Region {
  start: number // source seconds where the voice starts
  end: number // source seconds where a one-shot / non-looping voice stops
  loop: boolean
  loopStart: number
  loopEnd: number
}

/**
 * math §1: source position (seconds) of a Repitch voice, `elapsed` seconds after it started,
 * looping inside [loopStart, loopEnd) once reached. Null once a non-looping voice has run out.
 */
export function sourceTime(elapsed: number, rateNow: number, r: Region): number | null {
  const p = r.start + Math.max(0, elapsed) * rateNow
  if (r.loop && r.loopEnd - r.loopStart > 1e-3 && p >= r.loopEnd) {
    return r.loopStart + ((p - r.loopStart) % (r.loopEnd - r.loopStart))
  }
  if (p >= r.end) return null
  return p
}

/** math §6: picture opacity from loudness in dB (0 dB → 1, −60 dB → 0). */
export function opacity(gain: number): number {
  if (gain <= 0) return 0
  return Math.max(0, Math.min(1, 1 + (20 * Math.log10(gain)) / 60))
}

/** math §8: crossfade gains for a measured correlation r, x in [0, 1]. */
export function crossfade(x: number, r = 0): [number, number] {
  const th = (Math.PI / 2) * Math.max(0, Math.min(1, x))
  const k = 1 / Math.sqrt(1 + r * Math.sin(2 * th))
  return [k * Math.cos(th), k * Math.sin(th)]
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** Ableton naming: 60 = C3. */
export function noteName(n: number): string {
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 2}`
}

// ---------- filter, filter envelope, LFO (production.md §3 D, §5.2) -------------------------------
// One definition for the worklet (sound) and the stage (the picture twin), so a closing low-pass
// blurs the tile in step with the sound, live and in the export.

export type FilterType = 'off' | 'lp' | 'hp' | 'bp' | 'notch'
export interface FilterSpec {
  type: FilterType
  cutoff: number // Hz
  res: number // 0..1 (Q 0.5 .. 20)
  drive: number // 0..1, saturation before the filter
  envAmt: number // octaves the filter envelope adds at its peak (−8..8)
  env: Env
  key: number // key tracking, 0..1 (1 = the cutoff follows the note)
}
export const DEFAULT_FILTER: FilterSpec = { type: 'off', cutoff: 20000, res: 0.15, drive: 0, envAmt: 0, env: { a: 0.005, d: 0.5, s: 0, r: 0.4 }, key: 0 }

export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'random'
export interface LfoSpec {
  shape: LfoShape
  rate: number // Hz
  filter: number // octaves of cutoff swing
  volume: number // 0..1 tremolo depth
  pan: number // 0..1 auto-pan depth
  retrig: boolean // phase starts at each note (else it runs on the audio clock)
}
export const DEFAULT_LFO: LfoSpec = { shape: 'sine', rate: 4, filter: 0, volume: 0, pan: 0, retrig: true }

function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** LFO value in −1..1. `since` = seconds after note-on, `on` = note-on time on the audio clock. */
export function lfoValue(l: LfoSpec, since: number, on: number, seed: number): number {
  const ph = l.rate * Math.max(0, l.retrig ? since : on + since), f = ph - Math.floor(ph)
  switch (l.shape) {
    case 'sine': return Math.sin(2 * Math.PI * f)
    case 'triangle': return 1 - 4 * Math.abs(f - 0.5)
    case 'saw': return 1 - 2 * f
    case 'square': return f < 0.5 ? 1 : -1
    default: return hash01(Math.floor(ph) * 7919 + seed) * 2 - 1
  }
}

/** Cutoff in Hz `since` seconds after note-on, released at `off` (seconds after on, Infinity while held). */
export function cutoffAt(f: FilterSpec, l: LfoSpec | undefined, since: number, off: number, on: number, note: number, seed: number): number {
  const e = f.envAmt ? f.envAmt * envelope(since, off, f.env) : 0
  const m = l && l.filter ? l.filter * lfoValue(l, since, on, seed) : 0
  return Math.max(20, Math.min(20000, f.cutoff * Math.pow(2, e + m + (f.key * (note - 60)) / 12)))
}

/** Tremolo gain multiplier (1 = none). */
export function tremolo(l: LfoSpec | undefined, since: number, on: number, seed: number): number {
  return l && l.volume ? 1 - (l.volume * (1 - lfoValue(l, since, on, seed))) / 2 : 1
}

/** Auto-pan offset in −1..1. */
export function panLfo(l: LfoSpec | undefined, since: number, on: number, seed: number): number {
  return l && l.pan ? l.pan * lfoValue(l, since, on, seed) : 0
}

/** Trapezoidal SVF coefficients (Cytomic / Simper, math A6): [a1, a2, a3, k]. */
export function svfCoefs(fc: number, res: number, fs: number): [number, number, number, number] {
  const g = Math.tan((Math.PI * Math.min(fc, fs * 0.45)) / fs), k = 2 - 1.95 * Math.max(0, Math.min(1, res))
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2
  return [a1, a2, a3, k]
}

/**
 * The picture twin of the filter (design §5, math §7), as [blur, edge, glow, drive]:
 * low-pass → blur, octave for octave (1 kHz ≈ 0.56 % of the tile, 100 Hz ≈ 5.6 %); high-pass →
 * edges; resonance → edge glow; drive → contrast and saturation.
 */
export function filterTwin(f: FilterSpec, cutoff: number): [number, number, number, number] {
  if (f.type === 'off') return [0, 0, 0, f.drive]
  const lpBlur = Math.min(0.09, 0.0056 * (1000 / cutoff))
  const blur = f.type === 'lp' ? (cutoff > 16000 ? 0 : lpBlur) : f.type === 'bp' ? lpBlur * 0.5 : 0
  const edge = f.type === 'hp' ? Math.min(1, Math.log2(cutoff / 20) / 9) : f.type === 'bp' ? Math.min(0.7, Math.log2(cutoff / 20) / 12) : 0
  const glow = f.type === 'notch' ? 0 : f.res * f.res * 0.8
  return [blur, edge, glow, f.drive]
}
