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
