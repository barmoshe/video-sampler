// The voice engine: ONE AudioWorkletProcessor renders every voice (design §2). Per voice: a
// mip-mapped sample (pyramid) read with 4-point Hermite interpolation, a constant-power loop
// crossfade, ADSR and constant-power pan. The main thread owns allocation and stealing (it sends
// ids); this processor only renders. Spike: 128 voices cost 17.6 % of the audio thread, and
// aliasing at +36 st is 46 dB under Chrome's own buffer source.
import { crossfade, pyramidLevel } from '../voice-math'

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
}

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
    })
  }

  release(v: Voice, fastMs?: number) {
    if (v.stage === 3 && !fastMs) return
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
      for (let i = 0; i < n; i++) {
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
        const g = env * v.gain
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
