// Draws the collage for a moment of audio time: voice book → cells → layout → tiles → GPU.
// The live loop and the offline export both call drawAt(), so the export looks like the live stage.
import { Collage, FrameCache, createGL, fillCrop, type Blend, type Tile, type TexArray } from './gl'
import { LayoutEngine, type CellIn } from './layout'
import type { Clip, LayoutMode, Voice } from './types'
import { filterAt, gainAt, positionAt, rateAt } from './voicebook'
import { filterTwin, opacity } from './voice-math'

export interface DrawOptions {
  mode: LayoutMode
  homeCells?: { key: string; order: number; clipId: string | null; track?: string }[] // Pads: the visible bank
  homeBase?: number // the bank's first note (Home grid order = note − homeBase, 0..15)
  background?: [number, number, number]
  maxTaps?: number
  fit?: boolean
  displayFps?: number
  look?: Look
  hold?: number // seconds a looper layer's tile stays (its last frame) after its last note: the loop length
  section?: string // the current section: other sections' layer tiles are not held
  echo?: { time: number; feedback: number; level: number; decay: number; reverb: number } // the returns' picture twins: delay s, feedback, delay level, reverb decay s, reverb level
  mainAlpha?: number // the main video behind the tiles (ADR 0771)
  /** A song's tracks (ADR 0773): the stage is laid out by track first (`trackMode`), each track's notes inside its region (its own `mode`). */
  tracks?: { id: string; order: number; mode: LayoutMode }[]
  trackMode?: LayoutMode
  holdTracks?: number // seconds a track keeps its last frame between notes (the song's length while it plays)
}

/** How tiles are framed (production.md §3 A). Sizes are fractions of the stage's short side. */
export interface Look { gap: number; radius: number; border: number; borderRGB: [number, number, number]; pop: number }
export const CLEAN_LOOK: Look = { gap: 0.006, radius: 0.014, border: 0, borderRGB: [0.95, 0.94, 0.9], pop: 0.07 }
/** The looks the POST mode offers (ADR 0772): starting points the Look knobs then move. */
export const LOOKS: { id: string; name: string; look: Look }[] = [
  { id: 'clean', name: 'Clean', look: CLEAN_LOOK },
  { id: 'framed', name: 'Framed', look: { gap: 0.014, radius: 0.02, border: 0.005, borderRGB: [0.95, 0.94, 0.9], pop: 0.07 } },
  { id: 'seamless', name: 'Seamless', look: { gap: 0, radius: 0, border: 0, borderRGB: [0.95, 0.94, 0.9], pop: 0.03 } },
  { id: 'soft', name: 'Soft', look: { gap: 0.022, radius: 0.06, border: 0, borderRGB: [0.95, 0.94, 0.9], pop: 0.14 } },
  { id: 'signal', name: 'Signal', look: { gap: 0.01, radius: 0.012, border: 0.004, borderRGB: [0.95, 0.38, 0.11], pop: 0.1 } },
]

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
  inner = new Map<string, LayoutEngine>() // one per track, for its notes inside its region
  /** Where each track's tile is on the stage (0-1 of the frame), so the window can name it on the picture. */
  regions = new Map<string, { x: number; y: number; w: number; h: number }>()
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
    type Piece = { v: Voice; clip: Clip; q: number; W: number; alpha: number; k?: number } // k: an echo k delay times back
    const halos: { v: Voice; clip: Clip; q: number; alpha: number }[] = []
    const fx = o.echo
    const cells = new Map<string, { order: number; weight: number; born: number; pieces: Piece[]; track?: string }>()
    const mains: Piece[] = []
    if (this.held.size && [...this.held.values()].some((h) => h.seen > t + 1)) this.held.clear() // time went back (an export)
    for (const v of voices) {
      // a voice sent to the delay echoes for four delay times after it ends, to the reverb it glows for its tail
      const echoT = fx && v.sendA ? 4 * fx.time : 0, glowT = fx && v.sendB ? fx.decay * 0.6 : 0
      if (v.on > t || t >= v.dead + Math.max(echoT, glowT)) continue
      const clip = clips.get(v.clipId)
      if (!clip) continue
      if (v.cell === 'main') {
        if (t >= v.dead) continue
        const qm = positionAt(v, t, clip.duration)
        // the picture follows the envelope, not the bed's sound level (a muted bed still shows)
        const env = v.gain > 0 ? gainAt(v, t) / v.gain : t < v.off ? 1 : 0
        if (qm !== null) mains.push({ v, clip, q: qm * clip.fps, W: 0.5 * (clip.fps / dispFps), alpha: shown(opacity(env)) })
        continue
      }
      const home = o.tracks ? o.tracks.find((x) => x.id === v.track)?.mode === 'home' : o.mode === 'home'
      const order = v.cell.startsWith('L:') ? 1000 + Number(v.cell.split(':').at(-1)) : home ? Number.parseInt(v.cell.split(':')[1] ?? '', 10) - (o.homeBase ?? 36) : v.note
      if (home && (order < 0 || order > 15)) continue // another bank
      const c = cells.get(v.cell) ?? { order, weight: 0, born: v.on, pieces: [], track: v.track }
      const live = t < v.dead ? positionAt(v, t, clip.duration) : null
      const alpha = live === null ? 0 : shown(opacity(gainAt(v, t)))
      if (live !== null && alpha > 0.002) {
        c.weight = Math.max(c.weight, alpha)
        c.born = Math.max(c.born, v.on)
        c.pieces.push({ v, clip, q: live * clip.fps, W: rateAt(v, t) * 0.5 * (clip.fps / dispFps), alpha })
      }
      // the delay's twin: the picture as it was k delay times ago, fading as the sound's echoes do
      if (echoT) for (let k = 1; k <= 4; k++) {
        const tk = t - k * fx!.time
        if (tk < v.on || tk >= v.dead) continue
        const ak = shown(opacity(gainAt(v, tk))) * v.sendA! * fx!.level * Math.pow(fx!.feedback, k - 1) * 0.85
        const qk = ak > 0.02 ? positionAt(v, tk, clip.duration) : null
        if (qk === null) continue
        c.pieces.push({ v, clip, q: qk * clip.fps, W: 0, alpha: ak, k })
        c.weight = Math.max(c.weight, ak * 0.5)
      }
      // the reverb's twin: a soft glow around the tile that lasts as long as the tail
      if (glowT) {
        const ah = t < v.dead ? alpha * v.sendB! * fx!.reverb * 0.55 : v.sendB! * fx!.reverb * 0.4 * Math.exp(-(t - v.dead) / (fx!.decay * 0.22))
        const qh = positionAt(v, Math.min(t, v.dead - 1e-3), clip.duration)
        if (ah > 0.015 && qh !== null) { halos.push({ v, clip, q: qh * clip.fps, alpha: ah }); c.weight = Math.max(c.weight, 0.01) }
      }
      if (c.pieces.length || halos.some((h) => h.v === v)) cells.set(v.cell, c)
    }
    if ((o.mode === 'home' || o.tracks) && o.homeCells) for (const h of o.homeCells) if (h.clipId && !cells.has(h.key)) cells.set(h.key, { order: h.order, weight: 0, born: 0, pieces: [], track: h.track })
    // a song's tracks keep their tile between notes, showing the last frame, while the song plays
    if (o.tracks) {
      for (const tr of o.tracks) {
        let last: Piece | undefined
        for (const c of cells.values()) if (c.track === tr.id) for (const p of c.pieces) if (!p.k && (!last || p.v.on > last.v.on)) last = p
        if (last) this.held.set(`T:${tr.id}`, { clipId: last.clip.id, q: last.q, seen: t, order: tr.order })
      }
      for (const [key, h] of this.held) {
        if (!key.startsWith('T:')) continue
        const id = key.slice(2)
        if (t - h.seen > (o.holdTracks ?? 0) || !o.tracks.some((x) => x.id === id)) { this.held.delete(key); continue }
        if (![...cells.values()].some((c) => c.track === id && c.pieces.length)) cells.set(key, { order: 0, weight: 0.3, born: 0, pieces: [], track: id })
      }
    }
    // looper layers keep their tile between notes, showing the last frame, for one loop length
    for (const [key, c] of cells) { const p0 = c.pieces.find((p) => !p.k); if (key.startsWith('L:') && p0) this.held.set(key, { clipId: p0.clip.id, q: p0.q, seen: t, order: c.order }) }
    const hold = o.hold ?? 0
    for (const [key, h] of this.held) {
      if (!key.startsWith('L:')) continue
      if (t - h.seen > hold || (o.section && !key.startsWith(`L:${o.section}:`))) { this.held.delete(key); continue }
      if (!cells.has(key)) cells.set(key, { order: h.order, weight: 0.001, born: 0, pieces: [] })
    }
    const cellList: CellIn[] = [...cells].map(([key, c]) => ({ key, order: c.order, weight: c.weight, born: c.born }))
    const firstAspect = [...cells.values()].find((c) => c.pieces.length)?.pieces[0].clip.aspect ?? halos[0]?.clip.aspect ?? 16 / 9
    // the main video's place decides the tiles' area: behind (a smaller stage in the middle, so the
    // bed stays in view), beside (the right half), or in a corner (the tiles keep the whole stage)
    const place = mains[0] ? (mains[0].v.chain.split(':')[1] ?? 'behind') : 'none'
    const side = place === 'side'
    const inner = place === 'behind' && o.mode !== 'stack' ? 0.64 : 1
    const IW = side ? W / 2 : W * inner, IH = side ? H : H * inner, ox = side ? W / 2 : (W - IW) / 2, oy = side ? 0 : (H - IH) / 2
    let rects: Map<string, { x: number; y: number; w: number; h: number }>
    if (o.tracks) {
      // tracks first: each track one region of the stage; then each track's notes inside its region
      const byTrack = new Map<string, CellIn[]>()
      for (const [key, c] of cells) {
        const id = c.track ?? '_'
        const list = byTrack.get(id) ?? []
        list.push({ key, order: c.order, weight: c.weight, born: c.born })
        byTrack.set(id, list)
      }
      const info = new Map(o.tracks.map((x) => [x.id, x]))
      const outerCells: CellIn[] = [...byTrack].map(([id, list]) => ({ key: `T:${id}`, order: info.get(id)?.order ?? 99, weight: Math.max(...list.map((c) => c.weight)), born: Math.max(...list.map((c) => c.born)) }))
      // a split screen: up to three tracks side by side on a landscape frame, stacked on a portrait one
      const nT = Math.max(1, outerCells.length), fa = IW / Math.max(1, IH)
      const outerAspect = nT <= 3 ? (fa >= 1 ? fa / nT : fa * nT) : firstAspect
      const outer = this.layout.update(o.trackMode ?? 'gallery', outerCells, IW, IH, outerAspect, now, dt || 1 / dispFps)
      rects = new Map()
      for (const [id, list] of byTrack) {
        const r = outer.get(`T:${id}`)
        if (!r) continue
        let eng = this.inner.get(id)
        if (!eng) { eng = new LayoutEngine(); this.inner.set(id, eng) }
        // one note fills its track's region; a chord shares it
        const inner = eng.update(info.get(id)?.mode ?? o.mode, list, r.w, r.h, list.length === 1 ? r.w / Math.max(1, r.h) : firstAspect, now, dt || 1 / dispFps)
        for (const [k, ir] of inner) rects.set(k, { x: ir.x + r.x + ox, y: ir.y + r.y + oy, w: ir.w, h: ir.h })
      }
      for (const id of this.inner.keys()) if (!info.has(id)) this.inner.delete(id)
      this.regions = new Map()
      for (const id of byTrack.keys()) { const r = outer.get(`T:${id}`); if (r && info.has(id)) this.regions.set(id, { x: (r.x + ox) / W, y: (r.y + oy) / H, w: r.w / W, h: r.h / H }) }
    } else {
      this.regions = new Map()
      const raw = this.layout.update(o.mode, cellList, IW, IH, firstAspect, now, dt || 1 / dispFps)
      rects = ox === 0 && oy === 0 ? raw : new Map([...raw].map(([k, r]) => [k, { x: r.x + ox, y: r.y + oy, w: r.w, h: r.h }]))
    }

    const look = o.look ?? CLEAN_LOOK, short = Math.min(W, H)
    const framed = o.mode !== 'stack'
    const gap = framed ? Math.round(look.gap * short) : 0, radius = framed ? look.radius * short : 0, border = framed ? look.border * short : 0
    const frame = (r: { x: number; y: number; w: number; h: number }) => ({ ...inset(r, gap / 2), radius, border })
    this.collage.clear(W, H, o.background)
    // the main video: full frame behind everything, or the left half; a corner one is drawn last
    const mainTile = (p: Piece, r: { x: number; y: number; w: number; h: number }, framedTile: boolean): [TexArray, Tile] | null => {
      const cf = this.cache.clips.get(p.clip.id)
      if (!cf) return null
      const shownAspect = cf.rotation % 180 ? 1 / cf.aspect : cf.aspect
      const fr = framedTile ? frame(r) : { ...r, radius: 0, border: 0 }
      return [cf.M ?? cf.S, { ...fr, q: p.q, W: p.W, alpha: p.alpha * (o.mainAlpha ?? 1), crop: o.fit ? [0, 0, 1, 1] : fillCrop(shownAspect, fr.w / Math.max(1, fr.h)), rot: cf.rotation / 90 }]
    }
    if (place === 'behind' || side) for (const p of mains) {
      const mt = mainTile(p, side ? { x: 0, y: 0, w: W / 2, h: H } : { x: 0, y: 0, w: W, h: H }, side)
      if (mt) this.collage.draw(mt[0], [mt[1]], W, H, 'normal', o.maxTaps ?? 8, look.borderRGB)
    }
    const groups = new Map<TexArray, Tile[]>()
    const push = (arr: TexArray, tile: Tile) => { const g = groups.get(arr) ?? []; g.push(tile); groups.set(arr, g) }
    // idle Home-grid pads: their poster frame, dimmed
    if ((o.mode === 'home' || o.tracks) && o.homeCells) for (const h of o.homeCells) {
      const c = cells.get(h.key), r = rects.get(h.key)
      if (!r || !h.clipId || (c && c.pieces.length)) continue
      const cf = this.cache.clips.get(h.clipId)
      if (!cf) continue
      const shown = cf.rotation % 180 ? 1 / cf.aspect : cf.aspect
      push(cf.S, { ...frame(r), q: cf.poster, W: 0, alpha: 0.22, crop: o.fit ? [0, 0, 1, 1] : fillCrop(shown, r.w / r.h), rot: cf.rotation / 90 })
    }
    const glow = new Map<TexArray, Tile[]>()
    for (const hp of halos) { // the reverb's glow: a bigger, blurred copy behind the tile, added
      const r = rects.get(hp.v.cell), cf = this.cache.clips.get(hp.clip.id)
      if (!r || !cf) continue
      const g = glow.get(cf.S) ?? []
      g.push({ ...frame(scaleRect(r, 1.16)), q: hp.q, W: 0, alpha: hp.alpha, crop: o.fit ? [0, 0, 1, 1] : fillCrop(hp.clip.aspect, r.w / r.h), rot: cf.rotation / 90, fx: [0.07, 0, 0, 0] })
      glow.set(cf.S, g)
    }
    for (const [arr, tiles] of glow) this.collage.draw(arr, tiles, W, H, 'add', o.maxTaps ?? 8, look.borderRGB)
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
      for (const p of c.pieces.sort((a, b) => (b.k ?? 0) - (a.k ?? 0) || a.v.on - b.v.on)) { // echoes first, behind
        const cf = this.cache.clips.get(p.clip.id)
        if (!cf) continue
        const arr = cf.M && r.w > 300 ? cf.M : cf.S
        // the hit lands in the picture: a short pop on the attack (velocity), a small shrink as it fades
        const since = t - p.v.on
        const k = p.k ? 1 + 0.07 * p.k : (1 + look.pop * (p.v.vel / 127) * Math.exp(-since / 0.09)) * (t > p.v.off ? 0.94 + 0.06 * p.alpha : 1)
        const fr = framed ? frame(scaleRect(r, k)) : { ...r, radius: 0, border: 0 }
        const fc = filterAt(p.v, t)
        const fx = p.v.filter ? filterTwin(p.v.filter, fc ?? 20000) : undefined
        push(arr, { ...fr, fx, q: p.q, W: p.W, alpha: p.alpha, crop: o.fit ? [0, 0, 1, 1] : fillCrop(p.clip.aspect, fr.w / Math.max(1, fr.h)), rot: cf.rotation / 90 })
      }
    }
    const blend: Blend = o.mode === 'stack' ? 'screen' : 'normal'
    for (const [arr, tiles] of groups) this.collage.draw(arr, tiles, W, H, blend, o.maxTaps ?? 8, look.borderRGB)
    if (place === 'pip') for (const p of mains) { // a corner window over the tiles, a quarter of the stage
      const w = W * 0.34, h = Math.min(H * 0.34, (w * H) / W)
      const mt = mainTile(p, { x: W - w - short * 0.03, y: H - h - short * 0.03, w, h }, true)
      if (mt) this.collage.draw(mt[0], [mt[1]], W, H, 'normal', o.maxTaps ?? 8, look.borderRGB)
    }
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
