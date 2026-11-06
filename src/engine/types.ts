import type { Env, FilterSpec, LfoSpec, Region } from './voice-math'

/** A loaded clip: its sound (level 0 of the pyramid) and what analysis found. GL frames live in the FrameCache. */
export interface Clip {
  id: string
  name: string
  duration: number // seconds of the usable region (capped at 60 s in v1)
  fs: number
  channels: Float32Array[]
  fps: number
  frames: number
  width: number
  height: number
  aspect: number
  root: number // fractional MIDI note the clip sounds at (auto-root), 60 if unpitched
  rootFound: boolean
  poster: [number, number, number] // dominant colour, 0..1
  thumb: string // poster frame as an image URL (object URL), shown upright
  onsets: number[] // seconds
  cuts: number[] // seconds (scene changes)
  loudness: number // integrated LUFS (approx)
}

/** What an instrument asks the engine to play for one note. */
export interface NoteSpec {
  clipId: string
  cell: string // layout key: voices with the same cell share a tile
  chain: string
  rate: number
  region: Region
  reverse: boolean
  xfade: number
  gain: number // linear, before the envelope
  pan: number
  env: Env
  choke: number // 0 = none
  gate: boolean // false = plays to the end, ignores note-off
  mono: string | null // voices sharing this key cut each other (one-shot mono, slice mono)
  monoNote?: boolean // retrig: a new voice on the same note cuts the old one
  filter?: FilterSpec // per-voice filter (absent = none)
  lfo?: LfoSpec // per-voice LFO (absent = none)
  sendA?: number // to the delay return, 0..1
  sendB?: number // to the reverb return, 0..1
}

/** A sounding (or fading) voice, as the main thread knows it. The picture is a pure function of this. */
export interface Voice extends NoteSpec {
  id: number
  note: number
  vel: number
  on: number // audio-context time it starts
  off: number // audio-context time it was released (Infinity while held)
  dead: number // time after which nothing is audible
  rates: [number, number][] // [time, rate] from `on`, piecewise constant (pitch bend)
  gains: [number, number][] // [time, gain multiplier] (layer zones, macros), stepped with a 30 ms ramp
  stolen: boolean
}

export type InstrumentKind = 'clip' | 'pads' | 'layers'
export type LayoutMode = 'gallery' | 'keys' | 'stack' | 'mosaic' | 'spotlight' | 'home'
export type StageAspect = '16:9' | '9:16' | '1:1'
