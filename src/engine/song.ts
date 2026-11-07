// The song (ADR 0773): tracks of four kinds, a board of scenes to jam and a timeline to arrange. Both
// compile to the same play events the live engine and the MP4 export already use, so the song renders
// the way it plays. Pure functions: positions are beats; the transport turns them into seconds.
import { beatSeconds, quantize, type LoopNote, type Transport } from './looper'
import type { InstrumentState, PlayEvent } from './performer'
import type { LayoutMode } from './types'

export type TrackKind = 'instrument' | 'video' | 'backing' | 'picture'
export type TrackInst = Pick<InstrumentState, 'kind' | 'clip' | 'pads' | 'layers'>
export interface Cue { layout?: LayoutMode; look?: string }

/** A clip on the board or the timeline. Notes repeat every `loop` beats until `len` runs out. */
export interface SongClip {
  id: string
  start: number // beats on the timeline (0 in a board cell)
  len: number // beats it lasts
  loop: number // beats its content repeats every
  notes: LoopNote[] // instrument and video tracks
  media?: { clipId: string; offset: number } // backing tracks: the video from `offset` seconds
  cue?: Cue // picture tracks
}
export interface Mix { volume: number; pan: number; mute: boolean; solo: boolean } // dB, −1..1
export interface Track {
  id: string
  name: string
  hue: number // 0..360, the track's colour everywhere it shows
  kind: TrackKind
  inst: TrackInst // instrument and video tracks (a video track plays its recording as recorded)
  mix: Mix
  cells: Record<string, SongClip> // the board: scene id → clip
  clips: SongClip[] // the timeline
}
export interface Scene { id: string; name: string }
/** Where scenes were placed on the timeline: the arranger strip (and the export's layout cues). */
export interface Mark { at: number; len: number; scene: string }

export const HUES = [22, 210, 145, 275, 48, 340, 185, 100]
let seq = 0
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`
export const defaultMix = (): Mix => ({ volume: 0, pan: 0, mute: false, solo: false })
export const KIND_NAME: Record<TrackKind, string> = { instrument: 'Instrument', video: 'Video', backing: 'Backing', picture: 'Picture' }

export function newTrack(kind: TrackKind, inst: TrackInst, index: number, name?: string): Track {
  return { id: uid('t'), name: name ?? `${KIND_NAME[kind]} ${index + 1}`, hue: HUES[index % HUES.length], kind, inst, mix: defaultMix(), cells: {}, clips: [] }
}

/** Mute and solo: a soloed track plays, the rest go quiet; a muted track never plays. */
export function audible(t: Track, tracks: Track[]): boolean {
  if (t.mix.mute) return false
  return tracks.some((x) => x.mix.solo) ? t.mix.solo : true
}

/** The song's length in beats: where its last timeline clip ends. */
export const songEnd = (tracks: Track[]) => tracks.reduce((m, t) => t.clips.reduce((n, c) => Math.max(n, c.start + c.len), m), 0)
/** A scene's length in beats: its longest cell, rounded up to whole bars (at least one). */
export function sceneLen(tracks: Track[], scene: string, beatsPerBar: number): number {
  const L = tracks.reduce((m, t) => Math.max(m, t.cells[scene]?.len ?? 0), 0)
  return Math.max(beatsPerBar, Math.ceil(L / beatsPerBar - 1e-9) * beatsPerBar)
}

export interface SongEvent { beat: number; track: string; ev: PlayEvent }

/** One clip's events that start in [from, to) (beats), placed at `origin`. `resume`: a bed already running at `from` starts mid-way. */
function clipEvents(t: Track, c: SongClip, origin: number, from: number, to: number, resume: boolean, spb: number, out: SongEvent[]) {
  const s = origin + c.start, e = s + c.len
  if (e <= from || s >= to) return
  if (t.kind === 'backing' && c.media) {
    const gain = Math.pow(10, t.mix.volume / 20) * 0.9
    if (s >= from) out.push({ beat: s, track: t.id, ev: { type: 'main', clipId: c.media.clipId, gain, offset: c.media.offset, place: 'behind' } })
    else if (resume) out.push({ beat: from, track: t.id, ev: { type: 'main', clipId: c.media.clipId, gain, offset: c.media.offset + (from - s) * spb, place: 'behind' } })
    if (e >= from && e < to) out.push({ beat: e, track: t.id, ev: { type: 'main', clipId: null, gain: 0 } })
    return
  }
  if (t.kind === 'picture' && c.cue) {
    if (s >= from) {
      if (c.cue.layout) out.push({ beat: s, track: t.id, ev: { type: 'layout', mode: c.cue.layout } })
      if (c.cue.look) out.push({ beat: s, track: t.id, ev: { type: 'look', look: c.cue.look } })
    }
    return
  }
  const loop = Math.max(1 / 16, c.loop)
  const k0 = Math.max(0, Math.floor((from - s) / loop) - 1), k1 = Math.floor((Math.min(to, e) - s) / loop)
  for (let k = k0; k <= k1; k++) {
    for (const n of c.notes) {
      const on = s + k * loop + n.at
      if (on < from || on >= to || on >= e || n.at >= loop) continue
      const off = Math.min(on + Math.max(1 / 32, n.len), e)
      out.push({ beat: on, track: t.id, ev: { type: 'on', note: n.note, vel: n.vel, track: t.id } })
      out.push({ beat: off, track: t.id, ev: { type: 'off', note: n.note, track: t.id } })
    }
  }
}

/** Every timeline event in [from, to) beats, sorted. Muted (or not soloed) tracks are left out. `spb`: seconds a beat (for a bed resumed mid-way). */
export function timelineEvents(tracks: Track[], from: number, to: number, resume = false, spb = 0.5): SongEvent[] {
  const out: SongEvent[] = []
  for (const t of tracks) {
    if (!audible(t, tracks) && t.kind !== 'picture') continue
    for (const c of t.clips) clipEvents(t, c, 0, from, to, resume, spb, out)
  }
  return out.sort((a, b) => a.beat - b.beat || order(a.ev) - order(b.ev))
}

/** A scene on the board, launched at beat `origin` and looping every `len` beats: its events in [from, to). */
export function sceneEvents(tracks: Track[], scene: string, origin: number, len: number, from: number, to: number): SongEvent[] {
  const out: SongEvent[] = []
  if (to <= origin) return out
  const p0 = Math.max(0, Math.floor((from - origin) / len)), p1 = Math.floor((to - origin) / len)
  for (let p = p0; p <= p1; p++) {
    for (const t of tracks) {
      const c = t.cells[scene]
      if (!c || (!audible(t, tracks) && t.kind !== 'picture')) continue
      clipEvents(t, { ...c, start: 0, len }, origin + p * len, from, to, false, 0, out) // a shorter cell keeps looping for the whole scene
    }
  }
  return out.sort((a, b) => a.beat - b.beat || order(a.ev) - order(b.ev))
}
const order = (ev: PlayEvent) => (ev.type === 'off' ? 0 : ev.type === 'main' || ev.type === 'layout' || ev.type === 'look' ? 1 : 2) // offs before ons on the same beat

/** The whole timeline as a take: seconds from the start, every event tagged with its track. */
export function compileSong(tracks: Track[], tr: Transport): { events: { t: number; ev: PlayEvent }[]; duration: number } {
  const b = beatSeconds(tr.bpm), end = songEnd(tracks)
  return { events: timelineEvents(tracks, 0, end + 1e-6, false, b).map((e) => ({ t: e.beat * b, ev: e.ev })), duration: end * b }
}

/** Put a scene's cells on the timeline at beat `at` (each track's cell, looping to the scene's length). */
export function placeScene(tracks: Track[], scene: string, at: number, beatsPerBar: number): { tracks: Track[]; mark: Mark } {
  const len = sceneLen(tracks, scene, beatsPerBar)
  const next = tracks.map((t) => {
    const c = t.cells[scene]
    if (!c) return t
    const placed: SongClip = { ...structuredClone(c), id: uid('c'), start: at, len }
    return { ...t, clips: [...t.clips.filter((x) => x.start + x.len <= at || x.start >= at + len), placed].sort((a, b) => a.start - b.start) }
  })
  return { tracks: next, mark: { at, len, scene } }
}

/**
 * Records live playing onto the timeline: positions are beats from the song's start. The clip starts on
 * the bar where the first note fell and runs to the bar after the last note ends.
 */
export class TimelineRecorder {
  private open = new Map<number, { at: number; vel: number }>()
  notes: LoopNote[] = []
  private t0: number
  private tr: Transport
  constructor(t0: number, tr: Transport) { this.t0 = t0; this.tr = tr }
  beatAt(t: number) { return (t - this.t0) / beatSeconds(this.tr.bpm) }
  on(note: number, vel: number, t: number) { this.open.set(note, { at: this.beatAt(t), vel }) }
  off(note: number, t: number) {
    const o = this.open.get(note)
    if (!o) return
    this.open.delete(note)
    this.notes.push({ at: o.at, len: Math.max(1 / 16, this.beatAt(t) - o.at), note, vel: o.vel })
  }
  /** Close the take: notes still held end now; quantise; null when nothing was played. */
  finish(t: number): SongClip | null {
    for (const [note] of this.open) this.off(note, t)
    if (!this.notes.length) return null
    const B = this.tr.beats, div = this.tr.quantize
    const notes = this.notes.filter((n) => n.at > -B).map((n) => ({ ...n, at: div ? quantize(n.at, div, Infinity) : n.at, len: div ? Math.max(1 / div, Math.round(n.len * div) / div) : n.len }))
    if (!notes.length) return null
    const start = Math.max(0, Math.floor(Math.min(...notes.map((n) => n.at)) / B) * B)
    const end = Math.ceil(Math.max(...notes.map((n) => n.at + n.len)) / B - 1e-9) * B
    const len = Math.max(B, end - start)
    return { id: uid('c'), start, len, loop: len, notes: notes.map((n) => ({ ...n, at: n.at - start })).sort((a, b) => a.at - b.at) }
  }
}
