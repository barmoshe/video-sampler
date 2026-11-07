import { describe, expect, it } from 'vitest'
import { capturePhrase, type TakeEvent } from './take'

const on = (t: number, note: number): TakeEvent => ({ t, ev: { type: 'on', note, vel: 100 } })
const off = (t: number, note: number): TakeEvent => ({ t, ev: { type: 'off', note } })

describe('Capture', () => {
  it('keeps the latest phrase: back from the last note while the gaps stay under 4 s', () => {
    const buf = [on(1, 60), off(1.5, 60), on(10, 62), off(10.4, 62), on(11, 64), off(11.3, 64), on(13.5, 65), off(14, 65)]
    const got = capturePhrase(buf, 20)!
    expect(got.start).toBe(10)
    expect(got.events.filter((e) => e.ev.type === 'on').map((e) => (e.ev as { note: number }).note)).toEqual([62, 64, 65])
    expect(got.events[0].t).toBe(0)
  })
  it('ignores what is scheduled after now (loop notes queued ahead)', () => {
    const got = capturePhrase([on(1, 60), off(1.2, 60), on(5.1, 62)], 5)!
    expect(got.events.length).toBe(2)
  })
  it('returns nothing when nothing was played', () => {
    expect(capturePhrase([], 3)).toBeNull()
  })
})
