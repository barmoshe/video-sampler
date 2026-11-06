// Draws the collage for a moment of audio time: voice book → cells → layout → tiles → GPU.
// The live loop and the offline export both call drawAt(), so the export looks like the live stage.
import { Collage, FrameCache, createGL, fillCrop, type Blend, type Tile, type TexArray } from './gl'
import { LayoutEngine, type CellIn } from './layout'
import type { Clip, LayoutMode, Voice } from './types'
import { filterAt, gainAt, positionAt, rateAt } from './voicebook'
import { filterTwin, opacity } from './voice-math'

export interface DrawOptions {
  mode: LayoutMode
  homeCells?: { key: string; order: number; clipId: string | null }[] // Pads: the visible bank
  homeBase?: number // the bank's first note (Home grid order = note − homeBase, 0..15)
  background?: [number, number, number]
  maxTaps?: number
  fit?: boolean
  displayFps?: number
  look?: Look
}

/** How tiles are framed (production.md §3 A). Sizes are fractions of the stage's short side. */
export interface Look { gap: number; radius: number; border: number; borderRGB: [number, number, number]; pop: number }
export const CLEAN_LOOK: Look = { gap: 0.006, radius: 0.014, border: 0, borderRGB: [0.95, 0.94, 0.9], pop: 0.07 }

/**
 * What the eye sees of a voice's level: fully there until −36 dB, then gone by −60 dB, so a
 * release reads as long as it sounds (math §6) without turning grey for seconds.
 */
export function shown(alpha: number): number {
  return Math.max(0, Math.min(1, alpha / 0.4))
}

export class Stage {
  readonly gl: WebGL2RenderingContext
  readonly cache: FrameCache
  readonly collage: Collage
  layout = new LayoutEngine()
  private lastT = 0

  readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.gl = createGL(canvas)
    this.cache = new FrameCache(this.gl)
    this.collage = new Collage(this.gl)
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
  }

  /** Draw the stage for audio time t. `now` is a monotonic clock in seconds for springs. */
  drawAt(t: number, now: number, voices: Voice[], clips: Map<string, Clip>, o: DrawOptions): number {
    const W = this.canvas.width, H = this.canvas.height
    const dt = Math.min(0.1, Math.max(0, now - this.lastT))
    this.lastT = now
    const dispFps = o.displayFps ?? 60
    type Piece = { v: Voice; clip: Clip; q: number; W: number; alpha: number }
    const cells = new Map<string, { order: number; weight: number; born: number; pieces: Piece[] }>()
    for (const v of voices) {
      if (v.on > t || t >= v.dead) continue
      const clip = clips.get(v.clipId)
      if (!clip) continue
      const q = positionAt(v, t, clip.duration)
      if (q === null) continue
      const alpha = shown(opacity(gainAt(v, t)))
      if (alpha <= 0.002) continue
      const r = rateAt(v, t)
      const order = o.mode === 'home' ? Number(v.cell.split(':')[1]) - (o.homeBase ?? 36) : v.note
      if (o.mode === 'home' && (order < 0 || order > 15)) continue // another bank
      const c = cells.get(v.cell) ?? { order, weight: 0, born: v.on, pieces: [] }
      c.weight = Math.max(c.weight, alpha)
      c.born = Math.max(c.born, v.on)
      c.pieces.push({ v, clip, q: q * clip.fps, W: r * 0.5 * (clip.fps / dispFps), alpha })
      cells.set(v.cell, c)
    }
    if (o.mode === 'home' && o.homeCells) for (const h of o.homeCells) if (h.clipId && !cells.has(h.key)) cells.set(h.key, { order: h.order, weight: 0, born: 0, pieces: [] })
    const cellList: CellIn[] = [...cells].map(([key, c]) => ({ key, order: c.order, weight: c.weight, born: c.born }))
    const firstAspect = [...cells.values()].find((c) => c.pieces.length)?.pieces[0].clip.aspect ?? 16 / 9
    const rects = this.layout.update(o.mode, cellList, W, H, firstAspect, now, dt || 1 / dispFps)

    const look = o.look ?? CLEAN_LOOK, short = Math.min(W, H)
    const framed = o.mode !== 'stack'
    const gap = framed ? Math.round(look.gap * short) : 0, radius = framed ? look.radius * short : 0, border = framed ? look.border * short : 0
    const frame = (r: { x: number; y: number; w: number; h: number }) => ({ ...inset(r, gap / 2), radius, border })
    this.collage.clear(W, H, o.background)
    const groups = new Map<TexArray, Tile[]>()
    const push = (arr: TexArray, tile: Tile) => { const g = groups.get(arr) ?? []; g.push(tile); groups.set(arr, g) }
    // idle Home-grid pads: their poster frame, dimmed
    if (o.mode === 'home' && o.homeCells) for (const h of o.homeCells) {
      const c = cells.get(h.key), r = rects.get(h.key)
      if (!r || !h.clipId || (c && c.pieces.length)) continue
      const cf = this.cache.clips.get(h.clipId)
      if (!cf) continue
      const shown = cf.rotation % 180 ? 1 / cf.aspect : cf.aspect
      push(cf.S, { ...frame(r), q: cf.poster, W: 0, alpha: 0.22, crop: o.fit ? [0, 0, 1, 1] : fillCrop(shown, r.w / r.h), rot: cf.rotation / 90 })
    }
    for (const [key, c] of cells) {
      const r = rects.get(key)
      if (!r) continue
      for (const p of c.pieces.sort((a, b) => a.v.on - b.v.on)) {
        const cf = this.cache.clips.get(p.clip.id)
        if (!cf) continue
        const arr = cf.M && r.w > 300 ? cf.M : cf.S
        // the hit lands in the picture: a short pop on the attack (velocity), a small shrink as it fades
        const since = t - p.v.on
        const k = (1 + look.pop * (p.v.vel / 127) * Math.exp(-since / 0.09)) * (t > p.v.off ? 0.94 + 0.06 * p.alpha : 1)
        const fr = framed ? frame(scaleRect(r, k)) : { ...r, radius: 0, border: 0 }
        const fc = filterAt(p.v, t)
        const fx = p.v.filter ? filterTwin(p.v.filter, fc ?? 20000) : undefined
        push(arr, { ...fr, fx, q: p.q, W: p.W, alpha: p.alpha, crop: o.fit ? [0, 0, 1, 1] : fillCrop(p.clip.aspect, fr.w / Math.max(1, fr.h)), rot: cf.rotation / 90 })
      }
    }
    const blend: Blend = o.mode === 'stack' ? 'screen' : 'normal'
    for (const [arr, tiles] of groups) this.collage.draw(arr, tiles, W, H, blend, o.maxTaps ?? 8, look.borderRGB)
    return cellList.filter((c) => c.weight > 0).length
  }
}

/** A gap of g pixels on each side. */
function inset(r: { x: number; y: number; w: number; h: number }, g: number) {
  return { x: r.x + g, y: r.y + g, w: Math.max(0, r.w - 2 * g), h: Math.max(0, r.h - 2 * g) }
}

/** Scale a rectangle about its centre. */
function scaleRect(r: { x: number; y: number; w: number; h: number }, k: number) {
  return { x: r.x + (r.w * (1 - k)) / 2, y: r.y + (r.h * (1 - k)) / 2, w: r.w * k, h: r.h * k }
}
