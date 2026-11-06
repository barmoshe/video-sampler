// Draws the collage for a moment of audio time: voice book → cells → layout → tiles → GPU.
// The live loop and the offline export both call drawAt(), so the export looks like the live stage.
import { Collage, FrameCache, createGL, fillCrop, type Blend, type Tile, type TexArray } from './gl'
import { LayoutEngine, type CellIn } from './layout'
import type { Clip, LayoutMode, Voice } from './types'
import { gainAt, positionAt, rateAt } from './voicebook'
import { opacity } from './voice-math'

export interface DrawOptions {
  mode: LayoutMode
  homeCells?: { key: string; order: number; clipId: string | null }[] // Pads: the visible bank
  homeBase?: number // the bank's first note (Home grid order = note − homeBase, 0..15)
  background?: [number, number, number]
  maxTaps?: number
  fit?: boolean
  displayFps?: number
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
      const alpha = opacity(gainAt(v, t))
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
    if (o.mode === 'home' && o.homeCells) for (const h of o.homeCells) if (!cells.has(h.key)) cells.set(h.key, { order: h.order, weight: 0, born: 0, pieces: [] })
    const cellList: CellIn[] = [...cells].map(([key, c]) => ({ key, order: c.order, weight: c.weight, born: c.born }))
    const firstAspect = [...cells.values()].find((c) => c.pieces.length)?.pieces[0].clip.aspect ?? 16 / 9
    const rects = this.layout.update(o.mode, cellList, W, H, firstAspect, now, dt || 1 / dispFps)

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
      push(cf.S, { ...inset(r), q: cf.poster, W: 0, alpha: 0.22, crop: o.fit ? [0, 0, 1, 1] : fillCrop(shown, r.w / r.h), rot: cf.rotation / 90 })
    }
    for (const [key, c] of cells) {
      const r = rects.get(key)
      if (!r) continue
      for (const p of c.pieces.sort((a, b) => a.v.on - b.v.on)) {
        const cf = this.cache.clips.get(p.clip.id)
        if (!cf) continue
        const arr = cf.M && r.w > 300 ? cf.M : cf.S
        push(arr, { ...(o.mode === 'home' || o.mode === 'gallery' ? inset(r) : r), q: p.q, W: p.W, alpha: p.alpha, crop: o.fit ? [0, 0, 1, 1] : fillCrop(p.clip.aspect, r.w / r.h), rot: cf.rotation / 90 })
      }
    }
    const blend: Blend = o.mode === 'stack' ? 'screen' : 'normal'
    for (const [arr, tiles] of groups) this.collage.draw(arr, tiles, W, H, blend, o.maxTaps ?? 8)
    return cellList.filter((c) => c.weight > 0).length
  }
}

/** A hairline gap between tiles (1px on each side). */
function inset(r: { x: number; y: number; w: number; h: number }) {
  return { x: r.x + 1, y: r.y + 1, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - 2) }
}
