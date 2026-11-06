import { describe, expect, it } from 'vitest'
import { cutoffAt, DEFAULT_FILTER, DEFAULT_LFO, filterTwin, lfoValue, svfCoefs, tremolo, type FilterSpec } from './voice-math'

const LP = (x: Partial<FilterSpec> = {}): FilterSpec => ({ ...DEFAULT_FILTER, type: 'lp', cutoff: 1000, ...x })

describe('filter envelope and key tracking', () => {
  it('adds the envelope amount in octaves at the peak, and decays back', () => {
    const f = LP({ envAmt: 2, env: { a: 0.001, d: 0.5, s: 0, r: 0.3 } })
    expect(cutoffAt(f, undefined, 0.0015, Infinity, 0, 60, 1)).toBeCloseTo(4000, -1) // the attack peak (1.5 ms minimum)
    expect(cutoffAt(f, undefined, 3, Infinity, 0, 60, 1)).toBeCloseTo(1000, 0) // decayed to sustain 0
  })
  it('key tracking moves the cutoff with the note', () => {
    expect(cutoffAt(LP({ key: 1 }), undefined, 1, Infinity, 0, 72, 1)).toBeCloseTo(2000, 3)
    expect(cutoffAt(LP({ key: 0 }), undefined, 1, Infinity, 0, 72, 1)).toBeCloseTo(1000, 3)
  })
  it('stays inside 20 Hz .. 20 kHz', () => {
    expect(cutoffAt(LP({ cutoff: 15000, envAmt: 8, env: { a: 0.001, d: 1, s: 1, r: 1 } }), undefined, 0.5, Infinity, 0, 60, 1)).toBe(20000)
  })
})

describe('LFO', () => {
  it('is a deterministic function of time and seed (live and export agree)', () => {
    const l = { ...DEFAULT_LFO, shape: 'random' as const, rate: 3 }
    expect(lfoValue(l, 0.7, 12.3, 42)).toBe(lfoValue(l, 0.7, 12.3, 42))
    expect(lfoValue({ ...DEFAULT_LFO, rate: 1 }, 0.25, 0, 1)).toBeCloseTo(1) // sine peak
  })
  it('tremolo swings between 1 and 1 - depth', () => {
    const l = { ...DEFAULT_LFO, rate: 1, volume: 0.5 }
    expect(tremolo(l, 0.25, 0, 1)).toBeCloseTo(1)
    expect(tremolo(l, 0.75, 0, 1)).toBeCloseTo(0.5)
  })
})

describe('the picture twin', () => {
  it('a closing low-pass blurs more, octave for octave', () => {
    const [b1] = filterTwin(LP(), 1000), [b2] = filterTwin(LP(), 500)
    expect(b2 / b1).toBeCloseTo(2)
    expect(filterTwin(LP(), 18000)[0]).toBe(0) // open: sharp
  })
  it('high-pass shows edges, resonance glows, drive is contrast', () => {
    expect(filterTwin(LP({ type: 'hp' }), 2000)[1]).toBeGreaterThan(0.5)
    expect(filterTwin(LP({ res: 1 }), 1000)[2]).toBeCloseTo(0.8)
    expect(filterTwin({ ...DEFAULT_FILTER, drive: 0.6 }, 20000)).toEqual([0, 0, 0, 0.6])
  })
})

describe('SVF coefficients', () => {
  it('match the trapezoidal form (math A6)', () => {
    const [a1, a2, a3, k] = svfCoefs(1000, 0, 48000)
    const g = Math.tan((Math.PI * 1000) / 48000)
    expect(k).toBe(2)
    expect(a1).toBeCloseTo(1 / (1 + g * (g + 2)))
    expect(a2).toBeCloseTo(g * a1)
    expect(a3).toBeCloseTo(g * a2)
  })
})
