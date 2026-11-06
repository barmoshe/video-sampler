// The looper (ADR 0771): layers of notes on the bar grid, replayed ahead of time on the audio clock.
// A layer is notes, not recorded audio, so it stays re-playable, re-layoutable and exportable like a
// take; each layer draws into one tile (cell `L:<id>`), so the build is visible.

export interface LoopNote { at: number; len: number; note: number; vel: number } // beats from the loop's start
export interface Layer { id: number; notes: LoopNote[]; muted: boolean }

export interface Transport {
  bpm: number
  beats: number // beats per bar
  bars: number // loop length in bars
  metronome: boolean
  countIn: boolean
  quantize: 0 | 2 | 4 | 3 // subdivisions per beat (0 off, 2 = 8ths, 4 = 16ths, 3 = 8th triplets)
}
export const defaultTransport = (): Transport => ({ bpm: 100, beats: 4, bars: 2, metronome: true, countIn: true, quantize: 4 })

export const beatSeconds = (bpm: number) => 60 / bpm
export const loopBeats = (tr: Transport) => tr.bars * tr.beats
export const loopSeconds = (tr: Transport) => loopBeats(tr) * beatSeconds(tr.bpm)

/** Snap a beat position to the grid (subdivisions per beat), wrapping inside the loop. */
export function quantize(at: number, div: number, beats: number): number {
  if (!div) return at
  const q = Math.round(at * div) / div
  return q >= beats ? q - beats : q
}

/** A loop note's start and end in audio time for pass n of a loop that starts at t0. */
export function noteTimes(n: LoopNote, pass: number, t0: number, tr: Transport): { on: number; off: number } {
  const b = beatSeconds(tr.bpm), L = loopSeconds(tr)
  const on = t0 + pass * L + n.at * b
  return { on, off: on + Math.max(0.03, n.len * b) }
}

/** Every unmuted layer note that starts in [from, to), with its times, across loop passes. */
export function notesIn(layers: Layer[], t0: number, tr: Transport, from: number, to: number) {
  const L = loopSeconds(tr), out: { layer: number; n: LoopNote; on: number; off: number }[] = []
  if (to <= t0) return out
  const p0 = Math.max(0, Math.floor((from - t0) / L)), p1 = Math.floor((to - t0) / L)
  for (let pass = p0; pass <= p1; pass++) {
    for (const layer of layers) {
      if (layer.muted) continue
      for (const n of layer.notes) {
        const { on, off } = noteTimes(n, pass, t0, tr)
        if (on >= from && on < to) out.push({ layer: layer.id, n, on, off })
      }
    }
  }
  return out.sort((a, b) => a.on - b.on)
}

/** Metronome clicks in [from, to): their times and whether each starts a bar. */
export function clicksIn(t0: number, tr: Transport, from: number, to: number): { t: number; accent: boolean }[] {
  const b = beatSeconds(tr.bpm), out: { t: number; accent: boolean }[] = []
  let k = Math.ceil((from - t0) / b - 1e-9)
  for (let t = t0 + k * b; t < to; t = t0 + ++k * b) out.push({ t, accent: ((k % tr.beats) + tr.beats) % tr.beats === 0 })
  return out
}

/** Records one pass of live playing into a layer: positions are beats from the loop start, mod the loop. */
export class LayerRecorder {
  private open = new Map<number, { at: number; vel: number; t: number }>()
  notes: LoopNote[] = []
  private t0: number
  private tr: Transport
  constructor(t0: number, tr: Transport) { this.t0 = t0; this.tr = tr }

  private beatAt(t: number) {
    const B = loopBeats(this.tr)
    return ((((t - this.t0) / beatSeconds(this.tr.bpm)) % B) + B) % B
  }
  on(note: number, vel: number, t: number) { this.open.set(note, { at: this.beatAt(t), vel, t }) }
  off(note: number, t: number) {
    const o = this.open.get(note)
    if (!o) return
    this.open.delete(note)
    this.notes.push({ at: o.at, len: Math.max(0.0625, (t - o.t) / beatSeconds(this.tr.bpm)), note, vel: o.vel })
  }
  /** Close the pass: notes still held end now; quantise; return the layer's notes. */
  finish(t: number): LoopNote[] {
    for (const [note] of this.open) this.off(note, t)
    const B = loopBeats(this.tr), div = this.tr.quantize
    return this.notes
      .map((n) => ({ ...n, at: quantize(n.at, div, B), len: div ? Math.max(1 / div, Math.round(n.len * div) / div) : n.len }))
      .sort((a, b) => a.at - b.at)
  }
}
