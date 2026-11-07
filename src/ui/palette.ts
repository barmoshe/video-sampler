// Track colours (ADR 0775): one fixed palette, assigned in order like Live's clip colours, tuned to read
// on light and dark glass alike. Colour in VIDAW means identity or state, never decoration.
import { HUES, type Track } from '../engine/song'

export const PALETTE = ['#F2683C', '#3E8EF7', '#2EBD85', '#9B6CF6', '#F5B73B', '#EB5FA6', '#2BB7C4', '#86C540', '#E8823A', '#6B7CF5', '#D9A066', '#8E98A8']

/** A track's colour: its place in the palette (tracks store the hue they were given). */
export function trackColor(t: Pick<Track, 'hue'> | number): string {
  const hue = typeof t === 'number' ? t : t.hue
  const i = HUES.indexOf(hue)
  return i >= 0 ? PALETTE[i % PALETTE.length] : `hsl(${hue} 70% 55%)`
}
