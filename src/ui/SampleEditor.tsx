import { useEffect, useMemo, useRef } from 'react'
import { app } from '../engine/app'
import { sliceTimes, type ClipParams } from '../engine/instruments'
import type { Clip } from '../engine/types'
import { positionAt } from '../engine/voicebook'
import { peaks } from '../engine/waveform'

type Marker = 'start' | 'end' | 'loopStart' | 'loopEnd' | { slice: number }
const H = 72, GRAB = 7

/**
 * The sample editor (production.md §3 E): the clip's frames over its waveform, with start, end and
 * loop markers you drag, slice lines (double-click adds a manual slice in Slice mode, Alt-click on a
 * manual slice removes it), and a playhead for every voice of this clip that is sounding.
 */
export function SampleEditor({ p, clip }: { p: ClipParams; clip: Clip }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Marker | null>(null)
  const ps = useRef(p)
  useEffect(() => { ps.current = p })
  const pk = useMemo(() => peaks(clip.channels[0], clip.fs, 400, 0, clip.duration), [clip])
  const d = clip.duration

  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const c = cv.current
      if (!c) return
      const p = ps.current
      const w = c.clientWidth, dpr = Math.min(2, devicePixelRatio || 1)
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(H * dpr) }
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, H)
      const css = getComputedStyle(c)
      const ink = css.getPropertyValue('--ink').trim() || '#1d1d21', orange = css.getPropertyValue('--orange').trim() || '#f2621b'
      const blue = css.getPropertyValue('--blue').trim() || '#2c6ad1', rule = css.getPropertyValue('--rule').trim() || '#cdc6b8'
      const x = (frac: number) => frac * w
      // the loop, tinted
      if (p.mode === 'classic' && p.loop) { g.fillStyle = blue + '33'; g.fillRect(x(p.loopStart), 0, x(p.loopEnd) - x(p.loopStart), H) }
      // the waveform, dim outside the region
      const n = pk.length / 2, mid = H / 2
      for (let i = 0; i < n; i++) {
        const f = i / n, inside = f >= p.start && f <= p.end
        g.fillStyle = inside ? ink : rule
        const lo = pk[2 * i] * mid * 0.95, hi = pk[2 * i + 1] * mid * 0.95
        g.fillRect((i / n) * w, mid - hi, Math.max(1, w / n - 0.4), Math.max(1, hi - lo))
      }
      // slices: computed ones thin, manual ones with a handle
      if (p.mode === 'slice') {
        for (const t of sliceTimes(p, clip)) {
          const manual = p.slices.some((m) => Math.abs(m - t) < 1e-3)
          g.fillStyle = orange
          g.fillRect(x(t / d) - (manual ? 1 : 0.5), 0, manual ? 2 : 1, H)
          if (manual) { g.beginPath(); g.moveTo(x(t / d) - 5, 0); g.lineTo(x(t / d) + 5, 0); g.lineTo(x(t / d), 7); g.fill() }
        }
      }
      // start and end handles
      g.fillStyle = ink
      for (const [f, dir] of [[p.start, 1], [p.end, -1]] as const) {
        g.fillRect(x(f) - 1, 0, 2, H)
        g.beginPath(); g.moveTo(x(f), H); g.lineTo(x(f) + 8 * dir, H); g.lineTo(x(f), H - 9); g.fill()
      }
      // loop handles
      if (p.mode === 'classic' && p.loop) {
        g.fillStyle = blue
        for (const f of [p.loopStart, p.loopEnd]) { g.fillRect(x(f) - 1, 0, 2, H); g.beginPath(); g.arc(x(f), 6, 4, 0, Math.PI * 2); g.fill() }
      }
      // where each sounding voice of this clip is now
      const t = app.ctx.currentTime, book = app.performer?.book.voices ?? []
      g.fillStyle = orange
      for (const v of book) {
        if (v.clipId !== clip.id || v.on > t || t >= v.dead) continue
        const q = positionAt(v, t, d)
        if (q !== null) g.fillRect(x(q / d) - 1, 0, 2, H)
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [clip, pk, d])

  const fracAt = (e: React.PointerEvent | React.MouseEvent) => {
    const r = cv.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  /** The marker under the pointer. Loop handles sit on the top edge, region handles on the bottom, so
   *  where they overlap (a loop starting at the region's start) the pointer's height decides. */
  const nearest = (f: number, wpx: number, y: number): Marker | null => {
    const p = ps.current
    const region: [Marker, number][] = [['start', p.start], ['end', p.end]]
    const loop: [Marker, number][] = p.mode === 'classic' && p.loop ? [['loopStart', p.loopStart], ['loopEnd', p.loopEnd]] : []
    const cands = y < H * 0.4 ? [...loop, ...region] : [...region, ...loop]
    if (p.mode === 'slice') p.slices.forEach((t, i) => cands.push([{ slice: i }, t / d]))
    let best: Marker | null = null, bd = GRAB / wpx
    for (const [m, v] of cands) { const dd = Math.abs(v - f); if (dd < bd || (!best && dd <= bd)) { bd = dd; best = m } } // a tie keeps the first
    return best
  }
  const move = (m: Marker, f: number) => {
    const p = ps.current
    if (m === 'start') app.setClip({ start: Math.min(f, p.end - 0.01) })
    else if (m === 'end') app.setClip({ end: Math.max(f, p.start + 0.01) })
    else if (m === 'loopStart') app.setClip({ loopStart: Math.min(f, p.loopEnd - 0.01) })
    else if (m === 'loopEnd') app.setClip({ loopEnd: Math.max(f, p.loopStart + 0.01) })
    else app.setClip({ slices: p.slices.map((t, i) => (i === m.slice ? f * d : t)).sort((a, b) => a - b) })
  }

  return (
    <div className="sampler-ed">
      {clip.strip && <img className="filmstrip" src={clip.strip} alt="" draggable={false} />}
      <canvas
        ref={cv}
        style={{ height: H }}
        aria-hidden="true"
        onPointerDown={(e) => {
          const f = fracAt(e), m = nearest(f, cv.current!.clientWidth, e.clientY - cv.current!.getBoundingClientRect().top)
          if (e.altKey && m && typeof m === 'object') { app.setClip({ slices: ps.current.slices.filter((_, i) => i !== m.slice) }); return }
          if (!m) return
          drag.current = m
          try { cv.current!.setPointerCapture(e.pointerId) } catch { /* a pointer the browser does not count as pressed */ }
        }}
        onPointerMove={(e) => { if (drag.current) move(drag.current, fracAt(e)) }}
        onPointerUp={() => { drag.current = null }}
        onDoubleClick={(e) => {
          const p = ps.current
          if (p.mode !== 'slice') return
          app.setClip({ slices: [...p.slices, fracAt(e) * d].sort((a, b) => a - b) })
        }}
      />
      <p className="muted" style={{ margin: '6px 0 0' }}>
        Drag the black handles for the region{p.mode === 'classic' && p.loop ? ', the blue ones for the loop' : ''}.{p.mode === 'slice' ? ' Double-click to add a slice; Alt-click a slice you added to remove it.' : ''}
      </p>
    </div>
  )
}
