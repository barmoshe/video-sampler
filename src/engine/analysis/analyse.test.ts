import { describe, expect, it } from 'vitest'
import { autoRoot, loudness, onsets } from './analyse'

const FS = 48000

function tone(seconds: number, hz: number, clicksEverySec = 0): Float32Array {
  const x = new Float32Array(seconds * FS)
  for (let i = 0; i < x.length; i++) {
    x[i] = 0.25 * Math.sin((2 * Math.PI * hz * i) / FS) + (Math.random() - 0.5) * 0.002
    if (clicksEverySec && (i % (clicksEverySec * FS)) < 192) x[i] += 0.8 * (1 - (i % (clicksEverySec * FS)) / 192)
  }
  return x
}

describe('onsets (Slice by Transient)', () => {
  it('finds each click over a steady tone, and nothing in the tone alone', () => {
    const clicks = onsets(tone(10, 220, 1), FS)
    expect(clicks.length, `found ${clicks.length}`).toBeGreaterThanOrEqual(9)
    expect(clicks.length, `found ${clicks.length}`).toBeLessThanOrEqual(11)
    const none = onsets(tone(5, 220), FS).length
    expect(none, `found ${none} in a bare tone`).toBeLessThanOrEqual(1)
  })
})

describe('auto-root', () => {
  it('names A3 for a 220 Hz tone', () => {
    const r = autoRoot(tone(3, 220), FS)
    expect(r.found).toBe(true)
    expect(r.midi).toBeCloseTo(57, 1)
  })
})

describe('loudness', () => {
  it('reads a full-scale 1 kHz sine near −3 LUFS', () => {
    const x = new Float32Array(3 * FS).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / FS))
    expect(loudness([x, x], FS)).toBeGreaterThan(-1)
    expect(loudness([x, x], FS)).toBeLessThan(1)
    expect(loudness([x], FS)).toBeCloseTo(-3.0, 0)
  })
})
