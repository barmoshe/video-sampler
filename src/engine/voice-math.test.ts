import { describe, expect, it } from 'vitest'
import { crossfade, envelope, noteName, opacity, pyramidLevel, rate, sourceTime, velocityGain } from './voice-math'

describe('voice math', () => {
  it('maps notes to rates around C3', () => {
    expect(rate(60)).toBe(1)
    expect(rate(72)).toBeCloseTo(2)
    expect(rate(0)).toBeCloseTo(1 / 32)
    expect(rate(127)).toBeCloseTo(47.9, 0)
  })

  it('names notes the Ableton way', () => {
    expect(noteName(60)).toBe('C3')
    expect(noteName(36)).toBe('C1')
    expect(noteName(61)).toBe('C#3')
  })

  it('keeps velocity monotonic over a 40 dB range', () => {
    expect(velocityGain(127)).toBeCloseTo(1, 5)
    const g1 = velocityGain(1)
    expect(20 * Math.log10(g1)).toBeCloseTo(-40, 0)
    expect(velocityGain(64)).toBeGreaterThan(velocityGain(32))
  })

  it('shapes the envelope and its release', () => {
    expect(envelope(0, Infinity)).toBe(0)
    expect(envelope(0.005, Infinity)).toBeCloseTo(1, 2)
    expect(envelope(5, Infinity)).toBeCloseTo(0.8, 3)
    expect(envelope(1 + 0.4, 1)).toBeCloseTo(0.8 / 1000, 4)
  })

  it('picks the pyramid level so the step stays at or under 1', () => {
    expect(pyramidLevel(0.5, 7)).toBe(0)
    expect(pyramidLevel(1, 7)).toBe(0)
    expect(pyramidLevel(1.5, 7)).toBe(1)
    expect(pyramidLevel(8, 7)).toBe(3)
    expect(pyramidLevel(48, 7)).toBe(6)
  })

  it('runs a region, loops it, and ends a one-shot', () => {
    const r = { start: 1, end: 3, loop: false, loopStart: 0, loopEnd: 0 }
    expect(sourceTime(0.5, 2, r)).toBe(2)
    expect(sourceTime(1.5, 2, r)).toBeNull()
    const l = { start: 0, end: 10, loop: true, loopStart: 1, loopEnd: 3 }
    expect(sourceTime(4, 1, l)).toBeCloseTo(2)
  })

  it('fades in dB and crossfades at constant power', () => {
    expect(opacity(1)).toBe(1)
    expect(opacity(0.001)).toBeCloseTo(0, 5)
    const [a, b] = crossfade(0.5, 0)
    expect(a * a + b * b).toBeCloseTo(1)
    const [c, d] = crossfade(0.5, 1)
    expect(c + d).toBeCloseTo(1)
  })
})
