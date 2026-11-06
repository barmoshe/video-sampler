// Scale lock and chord mode (production.md §3 H): anyone sounds right on the first try.
// With the lock on, the QWERTY home row plays the scale's degrees from the key's tonic (A = tonic),
// the row above plays them an octave up, MIDI and on-screen notes snap down to the scale, and the
// piano dims what is out of key. Chord mode stacks thirds inside the scale (or fixed intervals
// when the lock is off), so one key plays a chord and the collage gains a tile per chord note.

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
} as const
export type ScaleName = keyof typeof SCALES
export type ChordMode = 'off' | 'triad' | 'seventh' | 'power' | 'octave'

export interface ScaleSetting {
  lock: boolean
  tonic: number // 0 = C … 11 = B
  scale: ScaleName
  chord: ChordMode
}
export const defaultScale = (): ScaleSetting => ({ lock: false, tonic: 0, scale: 'major', chord: 'off' })

/** Home row and the row above, left to right, as physical key codes (any keyboard layout). */
export const HOME_ROW = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote']
export const UPPER_ROW = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP']

const mod = (a: number, n: number) => ((a % n) + n) % n

export function inScale(note: number, s: ScaleSetting): boolean {
  return (SCALES[s.scale] as readonly number[]).includes(mod(note - s.tonic, 12))
}

/** The note of a scale degree (0 = the tonic at or above `c`, the C of the keyboard octave). */
export function degreeNote(c: number, s: ScaleSetting, degree: number): number {
  const sc = SCALES[s.scale], n = sc.length
  return c + s.tonic + 12 * Math.floor(degree / n) + sc[mod(degree, n)]
}

/** The scale degree of an in-scale note, counted from the tonic in octave 0 (MIDI 0 + tonic). */
export function degreeOf(note: number, s: ScaleSetting): number {
  const sc = SCALES[s.scale] as readonly number[], rel = note - s.tonic
  return Math.floor(rel / 12) * sc.length + sc.indexOf(mod(rel, 12))
}

/** An out-of-scale note moves down to the nearest scale note (in-scale notes are unchanged). */
export function snap(note: number, s: ScaleSetting): number {
  let n = note
  while (!inScale(n, s) && n > 0) n--
  return n
}

/** The note a QWERTY key plays with the lock on, or null if the key is not a note key. */
export function keyNote(code: string, c: number, s: ScaleSetting): number | null {
  const h = HOME_ROW.indexOf(code)
  if (h >= 0) return degreeNote(c, s, h)
  const u = UPPER_ROW.indexOf(code)
  if (u >= 0) return degreeNote(c, s, SCALES[s.scale].length + u)
  return null
}

/** The notes one key plays: the note itself, or a chord built on it. */
export function chordNotes(note: number, s: ScaleSetting): number[] {
  if (s.chord === 'off') return [note]
  if (s.chord === 'power') return [note, note + 7, note + 12].filter((n) => n <= 127)
  if (s.chord === 'octave') return [note, note + 12].filter((n) => n <= 127)
  const stack = s.chord === 'seventh' ? [0, 2, 4, 6] : [0, 2, 4]
  if (s.lock) {
    const d = degreeOf(snap(note, s), s)
    return stack.map((k) => degreeNote(0, s, d + k)).filter((n) => n <= 127)
  }
  return (s.chord === 'seventh' ? [0, 4, 7, 10] : [0, 4, 7]).map((i) => note + i).filter((n) => n <= 127)
}
