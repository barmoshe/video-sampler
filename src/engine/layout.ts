// The collage (design §6, math §4): six layouts, the stability rules that matter more than the
// shapes, and critically damped springs so tiles slide and resize and never jump.
import type { LayoutMode } from './types'

export interface Rect { x: number; y: number; w: number; h: number }
export interface CellIn { key: string; order: number; weight: number; born: number }

/** math §4.1: the biggest equal tile for N tiles of aspect a in W×H (the Jitsi search), pitch order. */
export function gallery(n: number, W: number, H: number, a: number): Rect[] {
  if (n <= 0) return []
  let best = { c: 1, r: n, w: 0 }
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c), w = Math.min(W / c, (a * H) / r)
    if (w > best.w + 1e-9) best = { c, r, w }
  }
  const tw = best.w, th = tw / a
  const oy = (H - best.r * th) / 2
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / best.c), inRow = Math.min(best.c, n - row * best.c), col = i % best.c
    const ox = (W - inRow * tw) / 2 // centre a short last row
    // low notes at the bottom left, rising to the top right
    return { x: ox + col * tw, y: oy + (best.r - 1 - row) * th, w: tw, h: th }
  })
}

/**
 * Home grid (Pads): each pad keeps its place in the 4×4 block (bottom row = the bank's first four),
 * but only the rows and columns that hold a loaded pad take space, so two pads fill the stage
 * instead of sitting in one corner of an empty grid.
 */
export function homeGrid(orders: number[], W: number, H: number, a: number): Map<number, Rect> {
  const valid = orders.filter((o) => o >= 0 && o < 16)
  const rows = [...new Set(valid.map((o) => Math.floor(o / 4)))].sort((x, y) => x - y)
  const cols = [...new Set(valid.map((o) => o % 4))].sort((x, y) => x - y)
  const out = new Map<number, Rect>()
  if (!valid.length) return out
  const tw = Math.min(W / cols.length, (H / rows.length) * a), th = tw / a
  const ox = (W - cols.length * tw) / 2, oy = (H - rows.length * th) / 2
  for (const o of valid) {
    const ci = cols.indexOf(o % 4), ri = rows.indexOf(Math.floor(o / 4))
    out.set(o, { x: ox + ci * tw, y: oy + (rows.length - 1 - ri) * th, w: tw, h: th })
  }
  return out
}

/** math §4.2: squarified treemap (Bruls, Huizing, van Wijk 2000) in input order (ordered: moves less). */
export function treemap(weights: number[], W: number, H: number): Rect[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const areas = weights.map((w) => (w / total) * W * H)
  const out: Rect[] = new Array(weights.length)
  let x = 0, y = 0, w = W, h = H, i = 0
  while (i < areas.length) {
    const side = Math.min(w, h)
    const row: number[] = [i]
    let worst = worstRatio([areas[i]], side)
    while (i + row.length < areas.length) {
      const next = [...row, i + row.length].map((k) => areas[k])
      const r = worstRatio(next, side)
      if (r > worst) break
      worst = r
      row.push(i + row.length)
    }
    const sum = row.reduce((a, k) => a + areas[k], 0)
    const thick = sum / side
    let off = 0
    for (const k of row) {
      const len = areas[k] / thick
      out[k] = w >= h ? { x, y: y + off, w: thick, h: len } : { x: x + off, y, w: len, h: thick }
      off += len
    }
    if (w >= h) { x += thick; w -= thick } else { y += thick; h -= thick }
    i += row.length
  }
  return out
}
function worstRatio(areas: number[], side: number): number {
  const s = areas.reduce((a, b) => a + b, 0), mx = Math.max(...areas), mn = Math.min(...areas)
  return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn))
}

export function targets(mode: LayoutMode, cells: CellIn[], W: number, H: number, tileAspect: number, capacity: number): Map<string, Rect> {
  const out = new Map<string, Rect>()
  const sorted = [...cells].sort((a, b) => a.order - b.order || a.born - b.born)
  if (mode === 'home') {
    const slots = homeGrid(sorted.map((c) => c.order), W, H, tileAspect)
    for (const c of sorted) { const s = slots.get(c.order); if (s) out.set(c.key, s) }
  } else if (mode === 'gallery') {
    const slots = gallery(Math.max(capacity, sorted.length), W, H, tileAspect)
    sorted.forEach((c, i) => out.set(c.key, slots[i]))
  } else if (mode === 'keys') {
    let lo = Math.min(...sorted.map((c) => c.order)), hi = Math.max(...sorted.map((c) => c.order))
    const mid = (lo + hi) / 2, span = Math.max(24, hi - lo + 4)
    lo = Math.floor(mid - span / 2); hi = lo + span
    const kw = W / (hi - lo)
    for (const c of sorted) {
      const h = H * (0.3 + 0.7 * c.weight)
      out.set(c.key, { x: (c.order - lo) * kw, y: H - h, w: kw, h })
    }
  } else if (mode === 'stack') {
    for (const c of sorted) out.set(c.key, { x: 0, y: 0, w: W, h: H })
  } else if (mode === 'mosaic') {
    const rects = treemap(sorted.map((c) => 0.15 + c.weight), W, H)
    sorted.forEach((c, i) => out.set(c.key, rects[i]))
  } else if (mode === 'spotlight') {
    const byAge = [...sorted].sort((a, b) => b.born - a.born)
    const strip = byAge.length > 1 ? H * 0.22 : 0
    if (byAge[0]) out.set(byAge[0].key, { x: 0, y: 0, w: W, h: H - strip })
    const rest = byAge.slice(1, 9)
    const sw = rest.length ? W / Math.max(4, rest.length) : 0
    rest.forEach((c, i) => out.set(c.key, { x: i * sw, y: H - strip, w: sw, h: strip }))
  }
  return out
}

interface Spring { x: number; y: number; w: number; h: number; vx: number; vy: number; vw: number; vh: number }

/** math §4.4, Holden's half-life form: settles in about four half-lives, never overshoots. */
function damp(x: number, v: number, goal: number, halflife: number, dt: number): [number, number] {
  const y = (4 * 0.69314718056) / (halflife + 1e-5) / 2
  const j0 = x - goal, j1 = v + j0 * y, e = Math.exp(-y * dt)
  return [e * (j0 + j1 * dt) + goal, e * (v - j1 * y * dt)]
}

/** The stability rules (math §4.3): instant arrivals, debounced departures, a Schmitt-triggered grid. */
export class LayoutEngine {
  private springs = new Map<string, Spring>()
  private members = new Set<string>()
  private targetRects = new Map<string, Rect>()
  private capacity = 0
  private fitsSince = Infinity
  private removedAt = Infinity
  private lastKey = ''
  halflife = 0.07

  reset() { this.springs.clear(); this.members.clear(); this.targetRects.clear(); this.capacity = 0; this.fitsSince = Infinity; this.removedAt = Infinity }

  update(mode: LayoutMode, cells: CellIn[], W: number, H: number, tileAspect: number, now: number, dt: number): Map<string, Rect> {
    const present = new Set(cells.map((c) => c.key))
    const added = [...present].some((k) => !this.members.has(k))
    const removed = [...this.members].some((k) => !present.has(k))
    const n = cells.length
    // Schmitt trigger: grow at once, shrink after the smaller grid has fitted for 400 ms
    if (n > this.capacity) { this.capacity = n; this.fitsSince = Infinity }
    else if (n < this.capacity) { if (this.fitsSince === Infinity) this.fitsSince = now; if (now - this.fitsSince > 0.4) { this.capacity = n; this.fitsSince = Infinity } }
    else this.fitsSince = Infinity
    if (removed && this.removedAt === Infinity) this.removedAt = now
    const settle = removed && now - this.removedAt > 0.12
    const dynamic = mode === 'keys' || mode === 'mosaic'
    const key = `${mode}|${W}|${H}|${tileAspect.toFixed(3)}|${this.capacity}`
    if (added || settle || dynamic || key !== this.lastKey) {
      // departures wait: a released voice keeps its cell until the re-flow
      const keep = settle ? cells : [...cells, ...[...this.members].filter((k) => !present.has(k)).map((k) => ({ key: k, order: this.order.get(k) ?? 0, weight: 0, born: 0 }))]
      for (const c of cells) this.order.set(c.key, c.order)
      this.targetRects = targets(mode, keep, W, H, tileAspect, this.capacity)
      this.members = new Set(keep.map((c) => c.key))
      if (settle) { this.removedAt = Infinity; for (const k of [...this.springs.keys()]) if (!present.has(k)) { this.springs.delete(k); this.order.delete(k) } }
      this.lastKey = key
    }
    const out = new Map<string, Rect>()
    for (const c of cells) {
      const t = this.targetRects.get(c.key)
      if (!t) continue
      let s = this.springs.get(c.key)
      if (!s) { s = { ...t, vx: 0, vy: 0, vw: 0, vh: 0 }; this.springs.set(c.key, s) }
      else {
        [s.x, s.vx] = damp(s.x, s.vx, t.x, this.halflife, dt);
        [s.y, s.vy] = damp(s.y, s.vy, t.y, this.halflife, dt);
        [s.w, s.vw] = damp(s.w, s.vw, t.w, this.halflife, dt);
        [s.h, s.vh] = damp(s.h, s.vh, t.h, this.halflife, dt)
      }
      out.set(c.key, { x: s.x, y: s.y, w: s.w, h: s.h })
    }
    return out
  }

  private order = new Map<string, number>()
}
