import { describe, expect, it } from 'vitest'
import { defaultClipParams, sliceTimes } from './instruments'
import type { Clip } from './types'

const clip = { duration: 4, onsets: [1, 2, 3], cuts: [2.5] } as Clip

describe('slices', () => {
  it('manual slices join the computed ones (Bitwig 6.1), in order', () => {
    const p = { ...defaultClipParams(), mode: 'slice' as const, sliceBy: 'transient' as const, slices: [1.5] }
    expect(sliceTimes(p, clip)).toEqual([0, 1, 1.5, 2, 3])
  })
  it('Manual uses only the slices you added', () => {
    const p = { ...defaultClipParams(), mode: 'slice' as const, sliceBy: 'manual' as const, slices: [0.5, 3.2] }
    expect(sliceTimes(p, clip)).toEqual([0, 0.5, 3.2])
  })
  it('two slices closer than 20 ms are one', () => {
    const p = { ...defaultClipParams(), mode: 'slice' as const, sliceBy: 'transient' as const, slices: [1.01] }
    expect(sliceTimes(p, clip)).toEqual([0, 1, 2, 3])
  })
})
