// Routes playing (notes, sustain, bend, selector, macros) through the active instrument into the
// voice book and the audio engine. Deterministic, so a recorded take replays to the same voices,
// live or offline (design §9: takes are events, not pixels).
import {
  clipNote, layersNote, noteSelector, padsNote, selectorValue, zone, effectiveChain, dB,
  type ClipParams, type LayersParams, type PadsParams,
} from './instruments'
import type { Clip, InstrumentKind, LayoutMode, NoteSpec, Voice } from './types'

/** Where a section's main video sits: behind the tiles, beside them (half the stage), or in a corner. */
export type MainPlace = 'behind' | 'side' | 'pip'
import { gainAt } from './voicebook'
import { VoiceBook } from './voicebook'
import { velocityGain } from './voice-math'
import type { EngineEvent } from './worklet/voice-engine'

export interface Sink { send(evs: EngineEvent[]): void; frameOf(t: number): number }

export interface InstrumentState {
  kind: InstrumentKind
  clip: ClipParams
  pads: PadsParams
  layers: LayersParams
  bendRange: number
}

/**
 * src: who plays the note (0 = the player's keys, k = looper layer k), so a loop and a held key on the
 * same note never release each other. cell: the tile the voice draws into (a looper layer keeps one
 * tile for all its notes, ADR 0771).
 */
export type PlayEvent =
  | { type: 'on'; note: number; vel: number; src?: number; cell?: string }
  | { type: 'off'; note: number; src?: number }
  | { type: 'main'; clipId: string | null; gain: number; offset?: number; place?: MainPlace } // the section's main video, from `offset` s
  | { type: 'layout'; mode: LayoutMode; section?: string } // a section starts here: its layout (a cue the export follows)
  | { type: 'sustain'; down: boolean }
  | { type: 'bend'; value: number } // −1..1
  | { type: 'macro'; index: number; value: number }
  | { type: 'panic' }

const STEAL_MS = 6, CHOKE_MS = 20

export class Performer {
  book = new VoiceBook()
  private sustain = false
  private sustained = new Set<number>() // voice ids held by the pedal
  private held = new Map<number, number[]>() // note → voice ids from that key
  private bend = 0 // semitones
  private rr = { n: 0 }
  private seed = 1
  onPlay?: (ev: PlayEvent, t: number) => void

  state: InstrumentState
  clips: Map<string, Clip>
  sink: Sink

  constructor(state: InstrumentState, clips: Map<string, Clip>, sink: Sink) {
    this.state = state
    this.clips = clips
    this.sink = sink
  }

  private rnd = () => { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296 }

  play(ev: PlayEvent, t: number) {
    this.onPlay?.(ev, t)
    if (ev.type === 'on') this.noteOn(ev.note, ev.vel, t, ev.src ?? 0, ev.cell)
    else if (ev.type === 'off') this.noteOff(ev.note, t, ev.src ?? 0)
    else if (ev.type === 'main') this.setMain(ev.clipId, ev.gain, t, ev.offset ?? 0, ev.place ?? 'behind')
    else if (ev.type === 'sustain') this.setSustain(ev.down, t)
    else if (ev.type === 'bend') this.setBend(ev.value * this.state.bendRange, t)
    else if (ev.type === 'macro') this.setMacro(ev.index, ev.value, t)
    else if (ev.type === 'panic') this.panic(t)
  }

  private specs(note: number, vel: number): { specs: NoteSpec[]; sel: number } {
    const s = this.state
    if (s.kind === 'clip') {
      const clip = s.clip.clipId ? this.clips.get(s.clip.clipId) : undefined
      return { specs: clip ? clipNote(s.clip, clip, note, vel) : [], sel: 0 }
    }
    if (s.kind === 'pads') return { specs: padsNote(s.pads, this.clips, note, vel), sel: 0 }
    const sel = noteSelector(s.layers, this.rr, this.rnd)
    return { specs: layersNote(s.layers, this.clips, note, vel, sel), sel }
  }

  private voiceCap(): number {
    const s = this.state
    return Math.max(1, Math.min(128, s.kind === 'clip' ? s.clip.voices : s.kind === 'pads' ? s.pads.voices : s.layers.voices))
  }

  noteOn(note: number, vel: number, t: number, src = 0, cell?: string) {
    const { specs: raw, sel } = this.specs(note, vel)
    if (!raw.length) return
    const specs = cell ? raw.map((sp) => ({ ...sp, cell })) : raw
    const evs: EngineEvent[] = []
    const frame = this.sink.frameOf(t)
    const live = this.book.live(t).filter((v) => v.cell !== 'main')
    // cut what this note replaces: retrig (same note), mono groups, choke groups
    for (const sp of specs) {
      for (const v of live) {
        if (v.off <= t && !sp.choke) continue
        const cut = (sp.monoNote && v.note === note && v.chain === sp.chain) || (sp.mono && v.mono === sp.mono) || (sp.choke && v.choke === sp.choke)
        if (cut) this.kill(v, t, sp.choke && v.choke === sp.choke ? CHOKE_MS : STEAL_MS, evs)
      }
    }
    // steal past the voice cap: released voices first, then the oldest
    const cap = this.voiceCap()
    let count = live.length
    while (count + specs.length > cap) {
      const pool = this.book.live(t).filter((v) => v.cell !== 'main')
      const victim = pool.find((v) => v.off <= t) ?? pool[0]
      if (!victim) break
      this.kill(victim, t, STEAL_MS, evs)
      count--
    }
    const ids: number[] = []
    for (const sp of specs) {
      const r = sp.rate * Math.pow(2, this.bend / 12)
      const v = this.book.add({ ...sp, rate: r }, note, vel, t)
      if (this.state.kind === 'layers') {
        const c = this.state.layers.chains.find((x) => x.id === sp.chain)
        if (c) v.gains[0][1] = zone(sel, c.selLo, c.selHi, c.selFade)
      }
      ids.push(v.id)
      evs.push({
        kind: 'on', frame, id: v.id, clip: sp.reverse ? `${sp.clipId}:rev` : sp.clipId, rate: r,
        start: sp.region.start, end: sp.region.end, loop: sp.region.loop, loopStart: sp.region.loopStart, loopEnd: sp.region.loopEnd,
        xfade: sp.xfade, gain: sp.gain * v.gains[0][1], pan: sp.pan, env: sp.env,
        note, filter: sp.filter, lfo: sp.lfo,
      })
    }
    const key = src * 1000 + note
    this.held.set(key, [...(this.held.get(key) ?? []), ...ids])
    this.sink.send(evs)
  }

  noteOff(note: number, t: number, src = 0) {
    const key = src * 1000 + note
    const ids = this.held.get(key)
    if (!ids) return
    this.held.delete(key)
    const evs: EngineEvent[] = []
    for (const id of ids) {
      const v = this.book.voices.find((x) => x.id === id)
      if (!v || !v.gate || v.off <= t) continue
      if (this.sustain) { this.sustained.add(id); continue }
      this.book.release(v, t)
      evs.push({ kind: 'off', frame: this.sink.frameOf(t), id })
    }
    if (evs.length) this.sink.send(evs)
  }

  private kill(v: Voice, t: number, ms: number, evs: EngineEvent[]) {
    this.book.release(v, t, ms)
    v.stolen = true
    this.sustained.delete(v.id)
    evs.push({ kind: 'off', frame: this.sink.frameOf(t), id: v.id, fastMs: ms })
  }

  setSustain(down: boolean, t: number) {
    this.sustain = down
    if (down) return
    const evs: EngineEvent[] = []
    for (const id of this.sustained) {
      const v = this.book.voices.find((x) => x.id === id)
      if (!v || v.off <= t) continue
      this.book.release(v, t)
      evs.push({ kind: 'off', frame: this.sink.frameOf(t), id })
    }
    this.sustained.clear()
    if (evs.length) this.sink.send(evs)
  }

  setBend(semi: number, t: number) {
    if (semi === this.bend) return
    const ratio = Math.pow(2, (semi - this.bend) / 12)
    this.bend = semi
    const evs: EngineEvent[] = []
    for (const v of this.book.live(t)) {
      if (!v.gate) continue
      const r = v.rates[v.rates.length - 1][1] * ratio
      this.book.setRate(v, t, r)
      evs.push({ kind: 'rate', frame: this.sink.frameOf(t), id: v.id, rate: r })
    }
    if (evs.length) this.sink.send(evs)
  }

  /** Macros move chain volumes and the selector; held Layers notes follow (the morph). */
  setMacro(index: number, value: number, t: number) {
    const L = this.state.layers
    const m = L.macros[index]
    if (!m) return
    m.value = Math.max(0, Math.min(127, value))
    if (this.state.kind !== 'layers') return
    const sel = selectorValue(L)
    const evs: EngineEvent[] = []
    for (const v of this.book.live(t)) {
      const raw = L.chains.find((c) => c.id === v.chain)
      if (!raw) continue
      const c = effectiveChain(raw, L.macros)
      const z = L.selectBy === 'macro' ? zone(sel, c.selLo, c.selHi, c.selFade) : v.gains[v.gains.length - 1][1]
      const base = velocityGain(v.vel) * dB(c.volume) * zone(v.note, c.keyLo, c.keyHi, c.keyFade) * zone(v.vel, c.velLo, c.velHi, c.velFade)
      v.gain = base
      this.book.setGain(v, t, z)
      evs.push({ kind: 'gain', frame: this.sink.frameOf(t), id: v.id, gain: base * z })
    }
    if (evs.length) this.sink.send(evs)
  }

  /** The main video: one looping voice in the cell 'main', drawn behind the tiles (ADR 0771). */
  setMain(clipId: string | null, gain: number, t: number, offset = 0, place: MainPlace = 'behind') {
    const evs: EngineEvent[] = []
    for (const v of this.book.live(t)) if (v.cell === 'main') this.kill(v, t, CHOKE_MS, evs)
    const clip = clipId ? this.clips.get(clipId) : undefined
    if (clip) {
      const sp: NoteSpec = {
        clipId: clip.id, cell: 'main', chain: `main:${place}`, rate: 1,
        region: { start: offset % clip.duration, end: clip.duration, loop: true, loopStart: 0, loopEnd: clip.duration },
        reverse: false, xfade: 0.05, gain, pan: 0, env: { a: 0.01, d: 1, s: 1, r: 0.3 }, choke: 0, gate: true, mono: null,
      }
      const v = this.book.add(sp, -1, 100, t)
      evs.push({
        kind: 'on', frame: this.sink.frameOf(t), id: v.id, clip: clip.id, rate: 1, start: offset % clip.duration, end: clip.duration, loop: true,
        loopStart: 0, loopEnd: clip.duration, xfade: 0.05, gain, pan: 0, env: sp.env, note: 60,
      })
    }
    if (evs.length) this.sink.send(evs)
  }

  /** All notes off. The main video keeps playing (it is not a note); setMain(null) stops it. */
  panic(t: number) {
    const evs: EngineEvent[] = []
    for (const v of this.book.live(t)) if (v.cell !== 'main') this.kill(v, t, CHOKE_MS, evs)
    this.held.clear(); this.sustained.clear(); this.sustain = false
    if (evs.length) this.sink.send(evs)
  }

  /** Visible voices at t with their picture values (for the layout and renderer). */
  visible(t: number) {
    return this.book.sounding(t).map((v) => ({ v, gain: gainAt(v, t) }))
  }
}
