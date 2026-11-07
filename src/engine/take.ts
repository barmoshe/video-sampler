// A take is events, not pixels (design §9): replayed through the instruments it re-renders in any
// layout and aspect. .mid files are takes too (import) and takes become .mid files (export).
import { Midi } from '@tonejs/midi'
import type { PlayEvent } from './performer'

export interface TakeEvent { t: number; ev: PlayEvent }
export interface Take { id?: string; name: string; events: TakeEvent[]; duration: number; hold?: number } // hold: looper layer tiles' hold (s)

/**
 * Capture (Ableton's Capture MIDI): the latest phrase from an always-on buffer of what was played,
 * as a take. The phrase runs back from the last note while the gaps between notes stay under `gap`
 * seconds. Times are audio-clock seconds; the take starts at the phrase's first note.
 */
export function capturePhrase(buf: TakeEvent[], now: number, gap = 4): { start: number; events: TakeEvent[] } | null {
  const past = buf.filter((e) => e.t <= now)
  const ons = past.filter((e) => e.ev.type === 'on')
  if (!ons.length) return null
  let i = ons.length - 1
  while (i > 0 && ons[i].t - ons[i - 1].t < gap) i--
  const start = ons[i].t
  return { start, events: past.filter((e) => e.t >= start - 1e-3).map((e) => ({ t: Math.max(0, e.t - start), ev: e.ev })) }
}

export function takeDuration(events: TakeEvent[]): number {
  return events.length ? events[events.length - 1].t : 0
}

export async function midiToTake(file: Blob, name: string): Promise<Take> {
  const midi = new Midi(await file.arrayBuffer())
  const events: TakeEvent[] = []
  for (const tr of midi.tracks) {
    for (const n of tr.notes) {
      events.push({ t: n.time, ev: { type: 'on', note: n.midi, vel: Math.max(1, Math.round(n.velocity * 127)) } })
      events.push({ t: n.time + Math.max(0.01, n.duration), ev: { type: 'off', note: n.midi } })
    }
    for (const cc of tr.controlChanges[64] ?? []) events.push({ t: cc.time, ev: { type: 'sustain', down: cc.value >= 0.5 } })
    for (const pb of tr.pitchBends) events.push({ t: pb.time, ev: { type: 'bend', value: pb.value } })
  }
  events.sort((a, b) => a.t - b.t || order(a.ev) - order(b.ev))
  return { name, events, duration: takeDuration(events) }
}

/** At equal times, note-offs go before note-ons (a repeated note re-strikes). */
function order(e: PlayEvent) { return e.type === 'off' ? 0 : e.type === 'on' ? 2 : 1 }

export function takeToMidi(take: Take): Uint8Array {
  const midi = new Midi()
  const tr = midi.addTrack()
  const open = new Map<number, { t: number; vel: number }[]>()
  for (const { t, ev } of take.events) {
    if (ev.type === 'on') open.set(ev.note, [...(open.get(ev.note) ?? []), { t, vel: ev.vel }])
    else if (ev.type === 'off') {
      const s = open.get(ev.note)?.shift()
      if (s) tr.addNote({ midi: ev.note, time: s.t, duration: Math.max(0.01, t - s.t), velocity: s.vel / 127 })
    } else if (ev.type === 'sustain') tr.addCC({ number: 64, value: ev.down ? 1 : 0, time: t })
    else if (ev.type === 'bend') tr.addPitchBend({ value: ev.value, time: t })
  }
  for (const [note, starts] of open) for (const s of starts) tr.addNote({ midi: note, time: s.t, duration: Math.max(0.01, take.duration - s.t), velocity: s.vel / 127 })
  return midi.toArray()
}
