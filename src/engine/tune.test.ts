import { describe, expect, it } from 'vitest'
import { clipRoot, defaultClipParams, homeKey, homeSpeed, octaveFor, padCents } from './instruments'
import type { Clip } from './types'

const clip = (root: number, rootFound = true) => ({ root, rootFound } as Clip)

describe('Tune (nearest note)', () => {
  it('puts a clip 39 cents sharp of A2 on A2, a little slower', () => {
    const p = defaultClipParams(), c = clip(57.39)
    expect(clipRoot(p, c)).toBeCloseTo(57.39)
    expect(homeKey(p, c)).toBe(57)
    expect(homeSpeed(p, c)).toBeCloseTo(Math.pow(2, -0.39 / 12)) // 2.2 % slower
  })
  it('rounds to the nearest note, up or down', () => {
    expect(homeKey(defaultClipParams(), clip(61.6))).toBe(62)
    expect(homeKey(defaultClipParams(), clip(61.4))).toBe(61)
  })
  it('plays an unpitched clip as recorded on C3', () => {
    const p = defaultClipParams(), c = clip(60, false)
    expect(homeKey(p, c)).toBe(60)
    expect(homeSpeed(p, c)).toBe(1)
  })
  it('"As recorded" ignores the detected pitch; "Manual" uses the set root', () => {
    expect(clipRoot({ ...defaultClipParams(), tune: 'original' }, clip(57.39))).toBe(60)
    expect(clipRoot({ ...defaultClipParams(), tune: 'manual', root: 64 }, clip(57.39))).toBe(64)
  })
  it('slice mode starts at C1', () => {
    expect(homeKey({ ...defaultClipParams(), mode: 'slice' }, clip(57.39))).toBe(36)
  })
})

describe('the keyboard follows the clip', () => {
  it('moves the QWERTY octave so the home key sits on the home row', () => {
    expect(octaveFor(60)).toBe(0) // C3: A key
    expect(octaveFor(57)).toBe(-1) // A2: the row starts at C2
    expect(octaveFor(72)).toBe(1)
    expect(octaveFor(36)).toBe(-2) // C1 for slices
    expect(octaveFor(0)).toBe(-5) // clamped
  })
})

describe('pads tune to the nearest note', () => {
  it('corrects a pitched pad by its cents, leaves an unpitched one alone', () => {
    expect(padCents({ tune: true }, clip(57.39))).toBeCloseTo(0.39)
    expect(padCents({ tune: true }, clip(57.7))).toBeCloseTo(-0.3)
    expect(padCents({ tune: false }, clip(57.39))).toBe(0)
    expect(padCents({ tune: true }, clip(60, false))).toBe(0)
  })
})
