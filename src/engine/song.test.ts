import { describe, expect, it } from 'vitest'
import { defaultClipParams, defaultLayersParams, defaultPadsParams } from './instruments'
import { defaultTransport } from './looper'
import { compileSong, newTrack, placeScene, sceneEvents, sceneLen, songEnd, timelineEvents, TimelineRecorder, type SongClip, type Track } from './song'

const inst = () => ({ kind: 'clip' as const, clip: defaultClipParams(), pads: defaultPadsParams(), layers: defaultLayersParams() })
const clip = (start: number, len: number, loop: number, notes: [number, number, number][]): SongClip =>
  ({ id: `c${start}`, start, len, loop, notes: notes.map(([at, l, note]) => ({ at, len: l, note, vel: 100 })) })
const ons = (evs: ReturnType<typeof timelineEvents>) => evs.filter((e) => e.ev.type === 'on').map((e) => [e.beat, (e.ev as { note: number }).note])

describe('the song', () => {
  it('plays a timeline clip, repeating its loop until the clip ends', () => {
    const t = newTrack('instrument', inst(), 0)
    t.clips = [clip(4, 6, 2, [[0, 0.5, 60], [1, 0.5, 64]])]
    expect(ons(timelineEvents([t], 0, 20))).toEqual([[4, 60], [5, 64], [6, 60], [7, 64], [8, 60], [9, 64]])
    expect(songEnd([t])).toBe(10)
  })
  it('a note never sounds past its clip\'s end, and each on has its off', () => {
    const t = newTrack('instrument', inst(), 0)
    t.clips = [clip(0, 3, 4, [[2, 4, 60]])]
    const evs = timelineEvents([t], 0, 10)
    expect(evs.map((e) => [e.ev.type, e.beat])).toEqual([['on', 2], ['off', 3]])
    expect((evs[0].ev as { track?: string }).track).toBe(t.id)
  })
  it('mute and solo decide which tracks play', () => {
    const a = newTrack('instrument', inst(), 0), b = newTrack('instrument', inst(), 1)
    a.clips = [clip(0, 4, 4, [[0, 1, 60]])]; b.clips = [clip(0, 4, 4, [[0, 1, 72]])]
    b.mix.solo = true
    expect(ons(timelineEvents([a, b], 0, 4))).toEqual([[0, 72]])
    b.mix.solo = false; a.mix.mute = true
    expect(ons(timelineEvents([a, b], 0, 4))).toEqual([[0, 72]])
  })
  it('a backing clip starts its video and stops it at the clip\'s end; resumed mid-way it starts at the right offset', () => {
    const t = newTrack('backing', inst(), 0)
    t.clips = [{ id: 'm', start: 2, len: 8, loop: 8, notes: [], media: { clipId: 'v', offset: 1 } }]
    const evs = timelineEvents([t], 0, 20)
    expect(evs.map((e) => [e.beat, e.ev.type, (e.ev as { clipId?: string | null }).clipId])).toEqual([[2, 'main', 'v'], [10, 'main', null]])
    const mid = timelineEvents([t], 6, 8, true, 0.5)
    expect((mid[0].ev as { offset: number }).offset).toBeCloseTo(1 + 4 * 0.5)
  })
  it('a scene loops on the board; placed on the timeline it fills the scene\'s length', () => {
    const a = newTrack('instrument', inst(), 0), b = newTrack('instrument', inst(), 1)
    a.cells = { A: clip(0, 4, 4, [[0, 1, 60]]) }
    b.cells = { A: clip(0, 8, 8, [[4, 1, 67]]) }
    expect(sceneLen([a, b], 'A', 4)).toBe(8)
    expect(ons(sceneEvents([a, b], 'A', 0, 8, 0, 16))).toEqual([[0, 60], [4, 60], [4, 67], [8, 60], [12, 60], [12, 67]])
    const { tracks, mark } = placeScene([a, b], 'A', 16, 4)
    expect(mark).toEqual({ at: 16, len: 8, scene: 'A' })
    expect(tracks.map((t: Track) => t.clips.map((c) => [c.start, c.len, c.loop]))).toEqual([[[16, 8, 4]], [[16, 8, 8]]])
  })
  it('compiles the timeline to a take in seconds', () => {
    const t = newTrack('instrument', inst(), 0)
    t.clips = [clip(0, 4, 4, [[2, 1, 60]])]
    const { events, duration } = compileSong([t], { ...defaultTransport(), bpm: 120 })
    expect(duration).toBe(2)
    expect(events.map((e) => [e.t, e.ev.type])).toEqual([[1, 'on'], [1.5, 'off']])
  })
  it('records onto the timeline from the bar the first note fell in', () => {
    const tr = { ...defaultTransport(), bpm: 120, quantize: 4 as const }
    const r = new TimelineRecorder(10, tr) // song start at audio time 10 s; a beat is 0.5 s
    r.on(60, 90, 10 + 5.02 * 0.5); r.off(60, 10 + 6 * 0.5) // beat 5.02 → bar 2 (beats 4-8)
    const c = r.finish(10 + 7 * 0.5)!
    expect([c.start, c.len, c.notes[0].at, c.notes[0].len]).toEqual([4, 4, 1, 1])
  })
})
