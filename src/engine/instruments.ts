// The three instruments (design §7): each turns one note into the voices it should play.
// Clip (Simpler-like), Pads (Drum Rack-like), Layers (Instrument Rack-like, equal to Pads: ADR 0767).
import type { Clip, NoteSpec } from './types'
import { DEFAULT_ENV, rate, velocityGain, type Env, type Region } from './voice-math'

export const dB = (x: number) => Math.pow(10, x / 20)

// ---------- Clip ---------------------------------------------------------------------------------
export type SliceBy = 'transient' | 'cut' | 'region'
export interface ClipParams {
  clipId: string | null
  mode: 'classic' | 'oneshot' | 'slice'
  rootAuto: boolean
  root: number
  transpose: number
  detune: number // cents
  start: number; end: number // fractions of the clip
  loop: boolean; loopStart: number; loopEnd: number; xfade: number // fractions, seconds
  voices: number
  retrig: boolean
  env: Env
  velRange: number // dB
  reverse: boolean
  oneShotPoly: boolean
  sliceBy: SliceBy
  sliceRegions: number
  slicePlayback: 'mono' | 'poly' | 'thru'
}
export const defaultClipParams = (): ClipParams => ({
  clipId: null, mode: 'classic', rootAuto: true, root: 60, transpose: 0, detune: 0,
  start: 0, end: 1, loop: true, loopStart: 0, loopEnd: 1, xfade: 0.03, voices: 128, retrig: true,
  env: { ...DEFAULT_ENV }, velRange: 40, reverse: false, oneShotPoly: false,
  sliceBy: 'transient', sliceRegions: 16, slicePlayback: 'mono',
})

export const SLICE_BASE = 36 // C1

export function clipRoot(p: ClipParams, clip: Clip): number {
  return p.rootAuto ? clip.root : p.root
}

/** Slice start times within [start, end] for the chosen method, at most 92 (C1 to G8). */
export function sliceTimes(p: ClipParams, clip: Clip): number[] {
  const s = p.start * clip.duration, e = p.end * clip.duration
  let pts: number[]
  if (p.sliceBy === 'region') pts = Array.from({ length: p.sliceRegions }, (_, i) => s + ((e - s) * i) / p.sliceRegions)
  else pts = [s, ...(p.sliceBy === 'cut' ? clip.cuts : clip.onsets).filter((t) => t > s + 0.03 && t < e - 0.03)]
  return pts.slice(0, 127 - SLICE_BASE + 1)
}

function reverseRegion(r: Region, d: number): Region {
  return { start: d - r.end, end: d - r.start, loop: r.loop, loopStart: d - r.loopEnd, loopEnd: d - r.loopStart }
}

export function clipNote(p: ClipParams, clip: Clip, note: number, vel: number): NoteSpec[] {
  const d = clip.duration
  const s = p.start * d, e = Math.max(p.end * d, s + 0.01)
  const base = { clipId: clip.id, chain: 'clip', cell: `n:${note}`, xfade: p.xfade, gain: velocityGain(vel, p.velRange), pan: 0, env: p.env, choke: 0 }
  let region: Region, r: number, gate = true, mono: string | null = null
  if (p.mode === 'slice') {
    const sl = sliceTimes(p, clip), i = note - SLICE_BASE
    if (i < 0 || i >= sl.length) return []
    region = { start: sl[i], end: p.slicePlayback === 'thru' ? e : (sl[i + 1] ?? e), loop: false, loopStart: 0, loopEnd: 0 }
    r = rate(60, 60, p.transpose, p.detune)
    gate = false
    mono = p.slicePlayback === 'mono' ? 'slice' : null
  } else {
    const ls = Math.min(Math.max(p.loopStart * d, s), e - 0.01), le = Math.max(Math.min(p.loopEnd * d, e), ls + 0.01)
    region = { start: s, end: e, loop: p.mode === 'classic' && p.loop, loopStart: ls, loopEnd: le }
    r = rate(note, clipRoot(p, clip), p.transpose, p.detune)
    if (p.mode === 'oneshot') { gate = false; mono = p.oneShotPoly ? null : 'oneshot' }
  }
  if (p.reverse) region = reverseRegion(region, d)
  return [{ ...base, rate: r, region, reverse: p.reverse, gate, mono, monoNote: p.retrig }]
}

// ---------- Pads ---------------------------------------------------------------------------------
export interface PadChain {
  note: number // receive
  clipId: string | null
  playNote: number // C3 = original pitch
  choke: number // 0 = none, 1..16
  volume: number // dB
  pan: number
  mute: boolean
  solo: boolean
  trim: number // dB, from loudness at ingest
  mode: 'oneshot' | 'classic'
  env: Env
}
export interface PadsParams { chains: PadChain[]; bank: number; voices: number; selected: number }
export const PAD_BASE = 36
export const newPad = (note: number, clipId: string | null = null): PadChain => ({
  note, clipId, playNote: 60, choke: 0, volume: 0, pan: 0, mute: false, solo: false, trim: 0, mode: 'oneshot',
  env: { a: 0.002, d: 1, s: 1, r: 0.05 },
})
export const defaultPadsParams = (): PadsParams => ({ chains: [], bank: 0, voices: 128, selected: PAD_BASE })

export function padsNote(p: PadsParams, clips: Map<string, Clip>, note: number, vel: number): NoteSpec[] {
  const anySolo = p.chains.some((c) => c.solo)
  return p.chains.flatMap((c, i): NoteSpec[] => {
    if (c.note !== note || !c.clipId || c.mute || (anySolo && !c.solo)) return []
    const clip = clips.get(c.clipId)
    if (!clip) return []
    const loop = c.mode === 'classic'
    return [{
      clipId: clip.id, chain: `pad:${c.note}:${i}`, cell: `p:${c.note}`, rate: rate(c.playNote, 60),
      region: { start: 0, end: clip.duration, loop, loopStart: 0, loopEnd: clip.duration },
      reverse: false, xfade: 0.02, gain: velocityGain(vel) * dB(c.volume + c.trim), pan: c.pan, env: c.env,
      choke: c.choke, gate: c.mode === 'classic', mono: null, monoNote: false,
    }]
  })
}

// ---------- Layers -------------------------------------------------------------------------------
export interface LayerChain {
  id: string
  clipId: string | null
  keyLo: number; keyHi: number; keyFade: number
  velLo: number; velHi: number; velFade: number
  selLo: number; selHi: number; selFade: number
  transpose: number
  volume: number
  pan: number
  mute: boolean
}
export type MacroParam = 'volume' | 'pan' | 'transpose' | 'selector'
export interface Macro { name: string; value: number; targets: { chain: string; param: MacroParam; min: number; max: number }[] }
export interface LayersParams {
  chains: LayerChain[]
  selector: number
  selectBy: 'macro' | 'roundrobin' | 'random'
  split: boolean
  voices: number
  env: Env
  macros: Macro[]
}
let chainSeq = 1
export const newLayer = (clipId: string | null = null): LayerChain => ({
  id: `L${chainSeq++}`, clipId, keyLo: 0, keyHi: 127, keyFade: 0, velLo: 1, velHi: 127, velFade: 0,
  selLo: 0, selHi: 127, selFade: 0, transpose: 0, volume: 0, pan: 0, mute: false,
})
export const defaultLayersParams = (): LayersParams => ({
  chains: [], selector: 0, selectBy: 'macro', split: false, voices: 128, env: { ...DEFAULT_ENV, r: 0.5 },
  macros: Array.from({ length: 8 }, (_, i) => ({
    name: i === 0 ? 'Selector' : `Macro ${i + 1}`, value: 0,
    targets: i === 0 ? [{ chain: '*', param: 'selector' as MacroParam, min: 0, max: 127 }] : [],
  })),
})

/** A zone's gain at x: 1 inside [lo, hi], fading to 0 over `fade` outside it (Live's fade ranges). */
export function zone(x: number, lo: number, hi: number, fade: number): number {
  if (x >= lo && x <= hi) return 1
  if (fade <= 0) return 0
  if (x < lo) return Math.max(0, 1 - (lo - x) / fade)
  return Math.max(0, 1 - (x - hi) / fade)
}

/** Chain parameters after the macros. */
export function effectiveChain(c: LayerChain, macros: Macro[]): LayerChain {
  const out = { ...c }
  for (const m of macros) for (const t of m.targets) {
    if (t.param === 'selector' || (t.chain !== '*' && t.chain !== c.id)) continue
    const v = t.min + ((t.max - t.min) * m.value) / 127
    if (t.param === 'volume') out.volume = v
    else if (t.param === 'pan') out.pan = v
    else if (t.param === 'transpose') out.transpose = Math.round(v)
  }
  return out
}

export function selectorValue(p: LayersParams): number {
  const fromMacro = p.macros.find((m) => m.targets.some((t) => t.param === 'selector'))
  if (!fromMacro) return p.selector
  const t = fromMacro.targets.find((x) => x.param === 'selector')!
  return t.min + ((t.max - t.min) * fromMacro.value) / 127
}

/** The selector a note sees: the macro's value, or the next chain's zone for round robin / random. */
export function noteSelector(p: LayersParams, rr: { n: number }, rnd: () => number): number {
  if (p.selectBy === 'macro') return selectorValue(p)
  const live = p.chains.filter((c) => c.clipId && !c.mute)
  if (!live.length) return 0
  const k = p.selectBy === 'roundrobin' ? rr.n++ % live.length : Math.floor(rnd() * live.length)
  return (live[k].selLo + live[k].selHi) / 2
}

export function layerGain(c: LayerChain, note: number, vel: number, sel: number): number {
  return zone(note, c.keyLo, c.keyHi, c.keyFade) * zone(vel, c.velLo, c.velHi, c.velFade) * zone(sel, c.selLo, c.selHi, c.selFade)
}

export function layersNote(p: LayersParams, clips: Map<string, Clip>, note: number, vel: number, sel: number): NoteSpec[] {
  return p.chains.flatMap((raw): NoteSpec[] => {
    const c = effectiveChain(raw, p.macros)
    if (!c.clipId || c.mute) return []
    const clip = clips.get(c.clipId)
    if (!clip) return []
    // key and velocity zones are fixed at note-on; the selector zone is a live multiplier the
    // performer sets (so turning the selector morphs held notes). A chain outside its selector zone
    // still starts, silent, ready to fade in.
    const z = zone(note, c.keyLo, c.keyHi, c.keyFade) * zone(vel, c.velLo, c.velHi, c.velFade)
    if (z <= 0) return []
    void sel
    return [{
      clipId: clip.id, chain: c.id, cell: p.split ? `n:${note}:${c.id}` : `n:${note}`,
      rate: rate(note, clip.root, c.transpose),
      region: { start: 0, end: clip.duration, loop: true, loopStart: 0, loopEnd: clip.duration },
      reverse: false, xfade: 0.03, gain: velocityGain(vel) * dB(c.volume) * z, pan: c.pan, env: p.env,
      choke: 0, gate: true, mono: null, monoNote: false,
    }]
  })
}
