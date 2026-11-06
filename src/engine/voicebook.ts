// The main thread's record of every voice. The picture is a pure function of this book and the
// time, so live play, take playback and the offline export all draw the same thing (design §2).
import type { NoteSpec, Voice } from './types'
import { cutoffAt, envelope, releaseTail, tremolo, type Region } from './voice-math'

export class VoiceBook {
  voices: Voice[] = []
  private nextId = 1

  add(spec: NoteSpec, note: number, vel: number, on: number): Voice {
    const v: Voice = {
      ...spec, id: this.nextId++, note, vel, on, off: Infinity, dead: Infinity,
      rates: [[on, spec.rate]], gains: [[on, 1]], stolen: false,
    }
    v.dead = naturalEnd(v)
    this.voices.push(v)
    return v
  }

  release(v: Voice, t: number, fastMs?: number) {
    if (v.off !== Infinity && !fastMs) return
    v.off = Math.min(v.off, t)
    if (fastMs) { v.env = { ...v.env, r: fastMs / 1000 }; v.off = t }
    v.dead = Math.min(naturalEnd(v), t + (fastMs ? fastMs / 1000 : releaseTail(v.env)))
  }

  setRate(v: Voice, t: number, r: number) {
    v.rates.push([t, r])
    if (v.off === Infinity) v.dead = naturalEnd(v)
  }

  setGain(v: Voice, t: number, g: number) { v.gains.push([t, g]) }

  /** Voices audible at t (started, not yet silent). */
  sounding(t: number): Voice[] { return this.voices.filter((v) => v.on <= t && t < v.dead) }

  /** Voices that still hold a key or ring at t (for allocation). */
  live(t: number): Voice[] { return this.voices.filter((v) => t < v.dead && !v.stolen) }

  prune(t: number, keep = 2) { this.voices = this.voices.filter((v) => v.dead > t - keep) }

  clear() { this.voices = []; this.nextId = 1 }
}

/** Source seconds played between `on` and t, through every rate change (math §1). */
export function played(v: Voice, t: number): number {
  let p = 0
  for (let k = 0; k < v.rates.length; k++) {
    const [t0, r] = v.rates[k]
    const t1 = k + 1 < v.rates.length ? v.rates[k + 1][0] : t
    const a = Math.max(t0, v.on), b = Math.min(t1, t)
    if (b > a) p += (b - a) * r
    if (t1 >= t) break
  }
  return p
}

/** Where the voice's source is at t (seconds into the clip), or null once a one-shot has ended. */
export function positionAt(v: Voice, t: number, clipDuration: number): number | null {
  const r: Region = v.region
  const p = r.start + played(v, t)
  let q: number
  if (r.loop && r.loopEnd - r.loopStart > 1e-3 && p >= r.loopEnd) q = r.loopStart + ((p - r.loopStart) % (r.loopEnd - r.loopStart))
  else if (p >= r.end) return null
  else q = p
  return v.reverse ? clipDuration - q : q
}

/** Linear gain at t: the spec's gain × the latest zone/macro multiplier × the envelope (math §6). */
export function gainAt(v: Voice, t: number): number {
  let m = 1
  for (const [tg, g] of v.gains) { if (tg <= t) m = g; else break }
  return v.gain * m * envelope(t - v.on, v.off - v.on, v.env) * tremolo(v.lfo, t - v.on, v.on, v.id)
}

/** The voice's filter cutoff at t (Hz), or null without a filter. */
export function filterAt(v: Voice, t: number): number | null {
  if (!v.filter || v.filter.type === 'off') return null
  return cutoffAt(v.filter, v.lfo, t - v.on, v.off - v.on, v.on, v.note, v.id)
}

export function rateAt(v: Voice, t: number): number {
  let r = v.rates[0][1]
  for (const [tr, rr] of v.rates) { if (tr <= t) r = rr; else break }
  return r
}

/** When a non-looping voice runs out of source, at its current rate (or never). */
function naturalEnd(v: Voice): number {
  const tail = releaseTail(v.env)
  if (v.region.loop) return v.off === Infinity ? Infinity : v.off + tail
  const remaining = v.region.end - v.region.start
  let t = v.on, left = remaining
  for (let k = 0; k < v.rates.length; k++) {
    const [t0, r] = v.rates[k]
    const t1 = k + 1 < v.rates.length ? v.rates[k + 1][0] : Infinity
    const a = Math.max(t0, v.on)
    const span = (t1 - a) * r
    if (span >= left) { t = a + left / r; left = 0; break }
    left -= span
    t = t1
  }
  const end = left > 0 ? Infinity : t
  return v.off === Infinity ? end : Math.min(end, v.off + tail)
}
