import { describe, expect, it } from 'vitest'
import { clicksIn, defaultTransport, LayerRecorder, loopSeconds, notesIn, quantize, type Layer } from './looper'

const tr = { ...defaultTransport(), bpm: 120, bars: 1, beats: 4 } // a 2 s loop, 0.5 s beats

describe('looper timing', () => {
  it('a 1-bar loop at 120 BPM lasts 2 s', () => expect(loopSeconds(tr)).toBe(2))
  it('replays each layer note once per pass, unmuted layers only', () => {
    const layers: Layer[] = [
      { id: 1, muted: false, notes: [{ at: 0, len: 1, note: 60, vel: 100 }, { at: 2, len: 1, note: 64, vel: 90 }] },
      { id: 2, muted: true, notes: [{ at: 1, len: 1, note: 67, vel: 80 }] },
    ]
    const got = notesIn(layers, 10, tr, 10, 14).map((x) => [x.layer, x.n.note, x.on])
    expect(got).toEqual([[1, 60, 10], [1, 64, 11], [1, 60, 12], [1, 64, 13]])
  })
  it('a window never schedules a note twice (half-open windows)', () => {
    const layers: Layer[] = [{ id: 1, muted: false, notes: [{ at: 1, len: 0.5, note: 60, vel: 100 }] }]
    const a = notesIn(layers, 0, tr, 0, 0.5).length, b = notesIn(layers, 0, tr, 0.5, 1).length
    expect(a + b).toBe(1)
  })
  it('clicks on every beat, accents on the bar', () => {
    expect(clicksIn(0, tr, 0, 2.1)).toEqual([{ t: 0, accent: true }, { t: 0.5, accent: false }, { t: 1, accent: false }, { t: 1.5, accent: false }, { t: 2, accent: true }])
  })
})

describe('recording a layer', () => {
  it('stores beats from the loop start, wraps past the end, quantises to 16ths', () => {
    const r = new LayerRecorder(0, tr)
    r.on(60, 100, 0.26); r.off(60, 0.75) // beat 0.52 → 0.5
    r.on(62, 90, 2.49); r.off(62, 2.74) // pass 2, beat 0.98 → 1
    const notes = r.finish(3)
    expect(notes.map((n) => [n.note, n.at])).toEqual([[60, 0.5], [62, 1]])
    expect(notes[0].len).toBe(1)
  })
  it('a held note ends when the pass closes', () => {
    const r = new LayerRecorder(0, { ...tr, quantize: 0 })
    r.on(60, 100, 0.5)
    expect(r.finish(1.5)[0].len).toBeCloseTo(2)
  })
  it('quantize wraps the last grid step to the loop start', () => expect(quantize(3.99, 4, 4)).toBe(0))
})
