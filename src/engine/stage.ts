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
  hold?: number // seconds a looper layer's tile stays (its last frame) after its last note: the loop length
  mainAlpha?: number // the main video behind the tiles (ADR 0771)
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
  private held = new Map<string, { clipId: string; q: number; seen: number; order: number }>() // looper layer tiles

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
    const mains: Piece[] = []
    if (this.held.size && [...this.held.values()].some((h) => h.seen > t + 1)) this.held.clear() // time went back (an export)
    for (const v of voices) {
      if (v.on > t || t >= v.dead) continue
      const clip = clips.get(v.clipId)
      if (!clip) continue
      if (v.cell === 'main') {
        const qm = positionAt(v, t, clip.duration)
        // the picture follows the envelope, not the bed's sound level (a muted bed still shows)
        const env = v.gain > 0 ? gainAt(v, t) / v.gain : t < v.off ? 1 : 0
        if (qm !== null) mains.push({ v, clip, q: qm * clip.fps, W: 0.5 * (clip.fps / dispFps), alpha: shown(opacity(env)) })
        continue
      }
      const q = positionAt(v, t, clip.duration)
      if (q === null) continue
      const alpha = shown(opacity(gainAt(v, t)))
      if (alpha <= 0.002) continue
      const r = rateAt(v, t)
      const order = v.cell.startsWith('L:') ? 1000 + Number(v.cell.slice(2)) : o.mode === 'home' ? Number(v.cell.split(':')[1]) - (o.homeBase ?? 36) : v.note
      if (o.mode === 'home' && (order < 0 || order > 15)) continue // another bank
      const c = cells.get(v.cell) ?? { order, weight: 0, born: v.on, pieces: [] }
      c.weight = Math.max(c.weight, alpha)
      c.born = Math.max(c.born, v.on)
      c.pieces.push({ v, clip, q: q * clip.fps, W: r * 0.5 * (clip.fps / dispFps), alpha })
      cells.set(v.cell, c)
    }
    if (o.mode === 'home' && o.homeCells) for (const h of o.homeCells) if (h.clipId && !cells.has(h.key)) cells.set(h.key, { order: h.order, weight: 0, born: 0, pieces: [] })
    // looper layers keep their tile between notes, showing the last frame, for one loop length
    for (const [key, c] of cells) if (key.startsWith('L:') && c.pieces[0]) this.held.set(key, { clipId: c.pieces[0].clip.id, q: c.pieces[0].q, seen: t, order: c.order })
    const hold = o.hold ?? 0
    for (const [key, h] of this.held) {
      if (t - h.seen > hold) { this.held.delete(key); continue }
      if (!cells.has(key)) cells.set(key, { order: h.order, weight: 0.001, born: 0, pieces: [] })
    }
    const cellList: CellIn[] = [...cells].map(([key, c]) => ({ key, order: c.order, weight: c.weight, born: c.born }))
    const firstAspect = [...cells.values()].find((c) => c.pieces.length)?.pieces[0].clip.aspect ?? 16 / 9
    // with a main video behind, the tiles sit inside a smaller stage so the bed stays in view
    const inner = mains.length && o.mode !== 'stack' ? 0.64 : 1
    const IW = W * inner, IH = H * inner, ox = (W - IW) / 2, oy = (H - IH) / 2
    const raw = this.layout.update(o.mode, cellList, IW, IH, firstAspect, now, dt || 1 / dispFps)
    const rects = inner === 1 ? raw : new Map([...raw].map(([k, r]) => [k, { x: r.x + ox, y: r.y + oy, w: r.w, h: r.h }]))

    const look = o.look ?? CLEAN_LOOK, short = Math.min(W, H)
    const framed = o.mode !== 'stack'
    const gap = framed ? Math.round(look.gap * short) : 0, radius = framed ? look.radius * short : 0, border = framed ? look.border * short : 0
    const frame = (r: { x: number; y: number; w: number; h: number }) => ({ ...inset(r, gap / 2), radius, border })
    this.collage.clear(W, H, o.background)
    // the main video, full frame, behind everything
    for (const p of mains) {
      const cf = this.cache.clips.get(p.clip.id)
      if (!cf) continue
      const shownAspect = cf.rotation % 180 ? 1 / cf.aspect : cf.aspect
      this.collage.draw(cf.M ?? cf.S, [{ x: 0, y: 0, w: W, h: H, q: p.q, W: p.W, alpha: p.alpha * (o.mainAlpha ?? 1), crop: o.fit ? [0, 0, 1, 1] : fillCrop(shownAspect, W / H), rot: cf.rotation / 90 }], W, H, 'normal', o.maxTaps ?? 8)
    }
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
      const h = !c.pieces.length ? this.held.get(key) : undefined
      if (h) { // a looper layer between its notes: its last frame, dimmed
        const cf = this.cache.clips.get(h.clipId)
        const clip = clips.get(h.clipId)
        if (cf && clip) push(cf.M && r.w > 300 ? cf.M : cf.S, { ...frame(r), q: h.q, W: 0, alpha: 0.45, crop: o.fit ? [0, 0, 1, 1] : fillCrop(clip.aspect, r.w / r.h), rot: cf.rotation / 90 })
        continue
      }
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
