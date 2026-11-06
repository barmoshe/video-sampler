import { describe, expect, it } from 'vitest'
import { defaultFx, delaySeconds, impulse } from './fx'

// a stand-in for an audio context: only sampleRate and createBuffer are used
const fake = (fs = 8000) => ({
  sampleRate: fs,
  createBuffer: (ch: number, len: number) => {
    const data = Array.from({ length: ch }, () => new Float32Array(len))
    return { length: len, numberOfChannels: ch, getChannelData: (c: number) => data[c] }
  },
}) as unknown as BaseAudioContext

describe('the reverb impulse', () => {
  it('is the same every time (live and export sound alike)', () => {
    const a = impulse(fake(), 1.5, 6000), b = impulse(fake(), 1.5, 6000)
    expect(a.getChannelData(0)).toEqual(b.getChannelData(0))
  })
  it('has unit energy and decays by about 60 dB over its decay time', () => {
    const fs = 8000, ir = impulse(fake(fs), 1, 3000), d = ir.getChannelData(0)
    let e = 0
    for (let c = 0; c < 2; c++) for (const v of ir.getChannelData(c)) e += v * v
    expect(e / 2).toBeCloseTo(1, 3)
    const rms = (a: number, b: number) => Math.sqrt(d.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a))
    const early = rms(Math.round(0.02 * fs), Math.round(0.07 * fs)), late = rms(Math.round(0.95 * fs), Math.round(1.0 * fs))
    expect(20 * Math.log10(late / early)).toBeLessThan(-45)
  })
})

describe('the delay time', () => {
  it('follows the tempo in beats', () => {
    expect(delaySeconds(defaultFx(), 120)).toBeCloseTo(0.375) // 1/8 dotted at 120 BPM
    expect(delaySeconds({ ...defaultFx(), delay: { ...defaultFx().delay, beats: 1 } }, 60)).toBe(1)
  })
})
