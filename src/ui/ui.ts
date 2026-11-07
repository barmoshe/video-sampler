// The shell's own state (ADR 0772): which mode the deck is in, which knob page, the "More" sheet, and
// the value that pops up over the stage while a knob turns. Views only: not in undo or the project.
import { createStore } from '../engine/store'
import type { InstrumentKind } from '../engine/types'

export type DeckMode = 'play' | 'shape' | 'mix' | 'post'
export const MODES: [DeckMode, string, string][] = [
  ['play', 'Play', 'keys, pads'],
  ['shape', 'Shape', 'sound, picture'],
  ['mix', 'Mix', 'tracks, faders'],
  ['post', 'Post', 'look, export'],
]


export const INSTRUMENTS: [InstrumentKind, string, string][] = [
  ['clip', 'Clip', 'One clip across the keys, at every pitch'],
  ['pads', 'Pads', 'A clip on each pad: drums, hits, phrases'],
  ['layers', 'Layers', 'Clips stacked, split by key or velocity, morphed by a macro'],
]

export interface Hud { label: string; value: string; hint?: string; at: number }
export interface UiState {
  mode: DeckMode
  page: Partial<Record<string, string>> // knob page per mode and instrument ("play:clip" → "filter")
  sheet: boolean // the full editor over the stage
  layer: string | null // the Layers instrument's selected layer (the knobs follow it)
  hud: Hud | null
  coach: boolean // the first-visit hint on the stage
  safe: boolean // POST: show where the apps put their buttons over a 9:16 frame
  pick: Pick | null // the clip selected on the board or the timeline (SHAPE edits its notes)
  ppb: number // the timeline's zoom: pixels a beat
  big: boolean // the stage takes the song view's room
}
/** A selected clip: a board cell (track × scene) or a timeline clip (track, clip id). */
export type Pick = { track: string; scene: string; clip?: undefined } | { track: string; clip: string; scene?: undefined }

const remembered = (): DeckMode => {
  try { const m = localStorage.getItem('vs.mode'); return m === 'shape' || m === 'mix' || m === 'post' ? m : 'play' } catch { return 'play' }
}

export const ui = createStore<UiState>({ mode: remembered(), page: {}, sheet: false, layer: null, hud: null, coach: true, safe: true, pick: null, ppb: 22, big: false })

export type Theme = 'light' | 'dark' | 'system'
/** Light by default (ADR 0774); dark, or the system's choice, from Settings. Remembered per browser. */
export function theme(): Theme {
  try { const t = localStorage.getItem('vs.theme'); return t === 'dark' || t === 'system' ? t : 'light' } catch { return 'light' }
}
export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  try { localStorage.setItem('vs.theme', t) } catch { /* a private window: the theme just isn't remembered */ }
}

export type Wall = 'mark' | 'plain'
/** The window's wallpaper (ADR 0775): the mark's three tiles, sharp, so the glass has colour to bend; or plain. */
export function wall(): Wall {
  try { return localStorage.getItem('vs.wall') === 'plain' ? 'plain' : 'mark' } catch { return 'mark' }
}
export function setWall(w: Wall) {
  document.documentElement.dataset.wall = w
  try { localStorage.setItem('vs.wall', w) } catch { /* a private window: the wallpaper just isn't remembered */ }
}

export function setMode(mode: DeckMode) {
  ui.set({ mode, sheet: false })
  try { localStorage.setItem('vs.mode', mode) } catch { /* private window: the mode just isn't remembered */ }
}

/** Show a value over the stage for a moment (OP-1 style), with what the picture does. */
export function hud(label: string, value: string, hint?: string) {
  ui.set({ hud: { label, value, hint, at: performance.now() } })
}
