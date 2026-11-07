// The window's own state (ADR 0776): which panes show around the stage, which knob page, what is picked
// in the song, and the value that pops up over the stage while a knob turns. Views only: not in undo or
// the project.
import { createStore } from '../engine/store'
import type { InstrumentKind } from '../engine/types'

export const INSTRUMENTS: [InstrumentKind, string, string][] = [
  ['clip', 'Clip', 'One clip across the keys, at every pitch'],
  ['pads', 'Pads', 'A clip on each pad: drums, hits, phrases'],
  ['layers', 'Layers', 'Clips stacked, split by key or velocity, morphed by a macro'],
]

export interface Hud { label: string; value: string; hint?: string; at: number }
/** The panes around the stage (the stage itself never hides): Option+1, 2 and 3 toggle them. */
export interface Panes { lib: boolean; insp: boolean; song: boolean }
export interface UiState {
  panes: Panes
  page: Partial<Record<string, string>> // knob page per instrument ("clip" → "filter")
  layer: string | null // the Layers instrument's selected layer (the knobs follow it)
  hud: Hud | null
  coach: boolean // the first-visit hint on the stage
  safe: boolean // show where the apps put their buttons over a 9:16 frame
  pick: Pick | null // the clip selected on the board or the timeline (the inspector edits its notes)
  ppb: number // the timeline's zoom: pixels a beat
  big: boolean // the stage alone: every pane steps aside
  picture: boolean // the picture itself is selected (the inspector shows its layout and look)
}
/** A selected clip: a board cell (track × scene) or a timeline clip (track, clip id). */
export type Pick = { track: string; scene: string; clip?: undefined } | { track: string; clip: string; scene?: undefined }

const panes = (): Panes => {
  try { const p = JSON.parse(localStorage.getItem('vs.panes') ?? '{}'); return { lib: p.lib !== false, insp: p.insp !== false, song: p.song !== false } } catch { return { lib: true, insp: true, song: true } }
}

export const ui = createStore<UiState>({ panes: panes(), page: {}, layer: null, hud: null, coach: true, safe: true, pick: null, ppb: 22, big: false, picture: false })

/** Show or hide a pane around the stage; remembered per browser. */
export function togglePane(k: keyof Panes) {
  const p = { ...ui.get().panes, [k]: !ui.get().panes[k] }
  ui.set({ panes: p, big: false })
  try { localStorage.setItem('vs.panes', JSON.stringify(p)) } catch { /* a private window: the panes just aren't remembered */ }
}

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

/** Show a value over the stage for a moment (OP-1 style), with what the picture does. */
export function hud(label: string, value: string, hint?: string) {
  ui.set({ hud: { label, value, hint, at: performance.now() } })
}
