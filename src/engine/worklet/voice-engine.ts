// The voice engine: ONE AudioWorkletProcessor renders every voice (design §2). Per voice: a
// mip-mapped sample (pyramid) read with 4-point Hermite interpolation, a constant-power loop
// crossfade, ADSR and constant-power pan. The main thread owns allocation and stealing (it sends
// ids); this processor only renders. Spike: 128 voices cost 17.6 % of the audio thread, and
// aliasing at +36 st is 46 dB under Chrome's own buffer source.
import { crossfade, cutoffAt, panLfo, pyramidLevel, svfCoefs, tremolo, type FilterSpec, type LfoSpec } from '../voice-math'

declare const sampleRate: number
declare const currentFrame: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
}

interface Clip { fs: number; levels: Float32Array[][] }

export interface OnEvent {
  kind: 'on'; frame: number; id: number; clip: string
  rate: number; start: number; end: number; loop: boolean; loopStart: number; loopEnd: number; xfade: number
  gain: number; pan: number; env: { a: number; d: number; s: number; r: number }
  note: number; filter?: FilterSpec; lfo?: LfoSpec
}
export interface OffEvent { kind: 'off'; frame: number; id: number; fastMs?: number }
/** A new gain multiplier, ramped over 30 ms (layer zones, macros: the chain-selector morph). */
export interface GainEvent { kind: 'gain'; frame: number; id: number; gain: number }
/** A new playback rate (pitch bend). */
export interface RateEvent { kind: 'rate'; frame: number; id: number; rate: number }
export type EngineEvent = OnEvent | OffEvent | GainEvent | RateEvent

interface Voice {
  id: number; data: Float32Array[]; scale: number; fsRatio: number
  pos: number; step: number; end: number; loop: boolean; ls: number; le: number; xf: number
  gain: number; gainTarget: number; gainStep: number; gL: number; gR: number
  env: number; stage: number; aInc: number; dMul: number; sus: number; rMul: number
  note: number; on: number; off: number; pan: number
  filter: FilterSpec | null; lfo: LfoSpec | null
  mode: number; a1: number; a2: number; a3: number; k: number; dk: number; dn: number
  s1L: number; s2L: number; s1R: number; s2R: number; trem: number
}

const MODES: Record<string, number> = { lp: 1, hp: 2, bp: 3, notch: 4 }
const CTRL = 32 // control rate for the filter, tremolo and pan: every 32 samples

const LN1000 = Math.log(1000)

class VoiceEngine extends AudioWorkletProcessor {
  clips = new Map<string, Clip>()
  voices: Voice[] = []
  events: EngineEvent[] = []

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent) => this.onMessage(e.data)
  }

  onMessage(m: { type: string; [k: string]: unknown }) {
    if (m.type === 'clip') this.clips.set(m.id as string, { fs: m.fs as number, levels: m.levels as Float32Array[][] })
    else if (m.type === 'unclip') this.clips.delete(m.id as string)
    else if (m.type === 'events') {
      for (const ev of m.events as EngineEvent[]) this.events.push(ev)
      this.events.sort((a, b) => a.frame - b.frame)
    } else if (m.type === 'panic') {
      this.events = []
      for (const v of this.voices) this.release(v, 20)
    }
    if (m.ack) this.port.postMessage({ type: 'ack', ack: m.ack })
  }

  noteOn(ev: OnEvent) {
    const clip = this.clips.get(ev.clip)
    if (!clip) return
    const step0 = ev.rate * (clip.fs / sampleRate)
    const level = pyramidLevel(step0, clip.levels.length)
    const scale = 1 / (1 << level)
    const fs = clip.fs * scale
    const th = ((Math.max(-1, Math.min(1, ev.pan)) + 1) * Math.PI) / 4
    this.voices.push({
      id: ev.id, data: clip.levels[level], scale, fsRatio: clip.fs / sampleRate,
      pos: ev.start * fs, step: step0 * scale, end: ev.end * fs,
      loop: ev.loop && ev.loopEnd - ev.loopStart > 0.005, ls: ev.loopStart * fs, le: ev.loopEnd * fs,
      xf: Math.min(ev.xfade * fs, (ev.loopEnd - ev.loopStart) * fs * 0.5, ev.loopStart * fs),
      gain: ev.gain, gainTarget: ev.gain, gainStep: 0, gL: Math.cos(th), gR: Math.sin(th),
      env: 0, stage: 0, aInc: 1 / (Math.max(0.0015, ev.env.a) * sampleRate),
      dMul: Math.exp(-LN1000 / (Math.max(1e-4, ev.env.d) * sampleRate)), sus: ev.env.s,
      rMul: Math.exp(-LN1000 / (Math.max(0.03, ev.env.r) * sampleRate)),
      note: ev.note, on: ev.frame / sampleRate, off: Infinity, pan: ev.pan,
      filter: ev.filter && (ev.filter.type !== 'off' || ev.filter.drive > 0) ? ev.filter : null,
      lfo: ev.lfo && (ev.lfo.filter || ev.lfo.volume || ev.lfo.pan) ? ev.lfo : null,
      mode: ev.filter ? MODES[ev.filter.type] ?? 0 : 0, a1: 0, a2: 0, a3: 0, k: 2,
      dk: 1 + 15 * (ev.filter?.drive ?? 0) ** 2, dn: 1 / Math.tanh(1 + 15 * (ev.filter?.drive ?? 0) ** 2),
      s1L: 0, s2L: 0, s1R: 0, s2R: 0, trem: 1,
    })
  }

  /** Filter coefficients, tremolo and pan for the moment t (audio-clock seconds). */
  control(v: Voice, t: number) {
    const since = t - v.on, off = v.off - v.on
    if (v.filter && v.mode) [v.a1, v.a2, v.a3, v.k] = svfCoefs(cutoffAt(v.filter, v.lfo ?? undefined, since, off, v.on, v.note, v.id), v.filter.res, sampleRate)
    if (v.lfo) {
      v.trem = tremolo(v.lfo, since, v.on, v.id)
      if (v.lfo.pan) {
        const th = ((Math.max(-1, Math.min(1, v.pan + panLfo(v.lfo, since, v.on, v.id))) + 1) * Math.PI) / 4
        v.gL = Math.cos(th); v.gR = Math.sin(th)
      }
    }
  }

  release(v: Voice, fastMs?: number) {
    if (v.stage === 3 && !fastMs) return
    if (v.stage !== 3) v.off = currentFrame / sampleRate
    v.stage = 3
    if (fastMs) v.rMul = Math.exp(-LN1000 / ((fastMs / 1000) * sampleRate))
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    const L = out[0], R = out[1] ?? out[0]
    const n = L.length
    const f0 = currentFrame
    while (this.events.length && this.events[0].frame < f0 + n) {
      const ev = this.events.shift()!
      if (ev.kind === 'on') { this.noteOn(ev); continue }
      for (const v of this.voices) {
        if (v.id !== ev.id) continue
        if (ev.kind === 'off') this.release(v, ev.fastMs)
        else if (ev.kind === 'gain') { v.gainTarget = ev.gain; v.gainStep = (ev.gain - v.gain) / (0.03 * sampleRate) }
        else if (ev.kind === 'rate') v.step = ev.rate * v.fsRatio * v.scale
      }
    }
    for (let vi = this.voices.length - 1; vi >= 0; vi--) {
      const v = this.voices[vi]
      const dl = v.data[0], dr = v.data[1] ?? v.data[0]
      const last = dl.length - 3
      const limit = Math.min(v.loop ? v.le : v.end, last)
      const span = v.le - v.ls
      let pos = v.pos, env = v.env, stage = v.stage
      let dead = false
      const shaped = v.filter !== null || v.lfo !== null
      for (let i = 0; i < n; i++) {
        if (shaped && (i & (CTRL - 1)) === 0) this.control(v, (f0 + i) / sampleRate)
        if (pos >= limit) {
          if (v.loop && span > 2) { pos = v.ls + (pos - limit); if (pos >= limit) pos = v.ls }
          else { dead = true; break }
        }
        let xl = hermite(dl, pos), xr = dr === dl ? xl : hermite(dr, pos)
        if (v.loop && v.xf > 1 && pos > v.le - v.xf) { // crossfade the seam (math §8)
          const [g1, g2] = crossfade((pos - (v.le - v.xf)) / v.xf, 0)
          const q = pos - span
          xl = xl * g1 + hermite(dl, q) * g2
          xr = dr === dl ? xl : xr * g1 + hermite(dr, q) * g2
        }
        if (stage === 0) { env += v.aInc; if (env >= 1) { env = 1; stage = 1 } }
        else if (stage === 1) env = v.sus + (env - v.sus) * v.dMul
        else if (stage === 3) { env *= v.rMul; if (env < 1e-3) { dead = true; break } }
        if (v.gainStep !== 0) {
          v.gain += v.gainStep
          if ((v.gainStep > 0 && v.gain >= v.gainTarget) || (v.gainStep < 0 && v.gain <= v.gainTarget)) { v.gain = v.gainTarget; v.gainStep = 0 }
        }
        if (v.filter) { // drive, then the state-variable filter (math A6), per channel
          if (v.dk > 1.001) { xl = Math.tanh(xl * v.dk) * v.dn; xr = Math.tanh(xr * v.dk) * v.dn }
        }
        if (v.mode) {
          let v3 = xl - v.s2L, v1 = v.a1 * v.s1L + v.a2 * v3, v2 = v.s2L + v.a2 * v.s1L + v.a3 * v3
          v.s1L = 2 * v1 - v.s1L; v.s2L = 2 * v2 - v.s2L
          xl = v.mode === 1 ? v2 : v.mode === 2 ? xl - v.k * v1 - v2 : v.mode === 3 ? v1 : xl - v.k * v1
          if (dr === dl) xr = xl
          else {
            v3 = xr - v.s2R; v1 = v.a1 * v.s1R + v.a2 * v3; v2 = v.s2R + v.a2 * v.s1R + v.a3 * v3
            v.s1R = 2 * v1 - v.s1R; v.s2R = 2 * v2 - v.s2R
            xr = v.mode === 1 ? v2 : v.mode === 2 ? xr - v.k * v1 - v2 : v.mode === 3 ? v1 : xr - v.k * v1
          }
        }
        const g = env * v.gain * v.trem
        L[i] += xl * g * v.gL
        R[i] += xr * g * v.gR
        pos += v.step
      }
      v.pos = pos; v.env = env; v.stage = stage
      if (dead) this.voices.splice(vi, 1)
    }
    return true
  }
}

function hermite(d: Float32Array, pos: number): number {
  const i = pos | 0, t = pos - i
  const xm = i > 0 ? d[i - 1] : d[i], x0 = d[i], x1 = d[i + 1], x2 = d[i + 2]
  const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1)
  return ((c3 * t + c2) * t + c1) * t + x0
}

registerProcessor('voice-engine', VoiceEngine)
