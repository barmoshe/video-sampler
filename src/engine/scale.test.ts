import { describe, expect, it } from 'vitest'
import { chordNotes, defaultScale, inScale, keyNote, snap, type ScaleSetting } from './scale'

const C = (p: Partial<ScaleSetting> = {}): ScaleSetting => ({ ...defaultScale(), lock: true, ...p })

describe('scale lock', () => {
  it('home row plays C major from A, the row above an octave up', () => {
    const s = C()
    expect(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'].map((k) => keyNote(k, 60, s))).toEqual([60, 62, 64, 65, 67, 69, 71, 72])
    expect(keyNote('KeyQ', 60, s)).toBe(72)
    expect(keyNote('KeyW', 60, s)).toBe(74)
    expect(keyNote('KeyZ', 60, s)).toBeNull()
  })
  it('A minor pentatonic starts on A', () => {
    const s = C({ tonic: 9, scale: 'minor pentatonic' })
    expect(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH'].map((k) => keyNote(k, 60, s))).toEqual([69, 72, 74, 76, 79, 81])
  })
  it('snaps an out-of-key note down to the scale', () => {
    const s = C()
    expect(inScale(61, s)).toBe(false)
    expect(snap(61, s)).toBe(60)
    expect(snap(66, s)).toBe(65)
    expect(snap(64, s)).toBe(64)
  })
})

describe('chord mode', () => {
  it('stacks thirds inside the scale', () => {
    expect(chordNotes(60, C({ chord: 'triad' }))).toEqual([60, 64, 67]) // C major
    expect(chordNotes(62, C({ chord: 'triad' }))).toEqual([62, 65, 69]) // D minor, in C major
    expect(chordNotes(67, C({ chord: 'seventh' }))).toEqual([67, 71, 74, 77]) // G7
  })
  it('uses fixed intervals without the lock, and power chords and octaves anywhere', () => {
    expect(chordNotes(61, { ...defaultScale(), chord: 'triad' })).toEqual([61, 65, 68])
    expect(chordNotes(60, C({ chord: 'power' }))).toEqual([60, 67, 72])
    expect(chordNotes(60, C({ chord: 'octave' }))).toEqual([60, 72])
    expect(chordNotes(60, C({ chord: 'off' }))).toEqual([60])
  })
})
