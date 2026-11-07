import { useRef } from 'react'
import { app } from '../engine/app'
import type { LoopNote } from '../engine/looper'
import type { SongClip, Track } from '../engine/song'
import { useStore } from '../engine/store'
import { noteName } from '../engine/voice-math'
import type { Pick } from './ui'

const BLACK = new Set([1, 3, 6, 8, 10])
/** Hear a note as it is placed or picked up. */
function audition(n: number) { app.handlers.noteOn(n, 100, performance.now(), 'keys'); setTimeout(() => app.handlers.noteOff(n, performance.now()), 180) }

/** The selected clip's notes: click an empty spot to add one, drag a note to move it, Alt-click to remove it. */
export function PianoRoll({ pick }: { pick: Pick }) {
  const tracks = useStore(app.store, (s) => s.tracks)
  const beats = useStore(app.store, (s) => s.transport.beats)
  const t = tracks.find((x) => x.id === pick.track)
  const c = t && (pick.scene ? t.cells[pick.scene] : t.clips.find((x) => x.id === pick.clip))
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ i: number; x: number; y: number; at: number; note: number } | null>(null)
  if (!t || !c) return <p className="muted pad">The clip is gone.</p>
  if (t.kind === 'picture' || t.kind === 'backing') return <CueOrMedia t={t} c={c} pick={pick} />
  const notes = c.notes
  const lo = Math.min(48, ...notes.map((n) => n.note)) - 2, hi = Math.max(72, ...notes.map((n) => n.note)) + 2
  const rows = hi - lo + 1, L = c.loop
  const save = (next: LoopNote[]) => {
    const clip: SongClip = { ...c, notes: next.sort((a, b) => a.at - b.at) }
    if (pick.scene) app.setCell(t.id, pick.scene, clip); else app.setClipAt(t.id, c.id, { notes: clip.notes })
  }
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { beat: ((e.clientX - r.left) / r.width) * L, note: hi - Math.floor(((e.clientY - r.top) / r.height) * rows) }
  }
  return (
    <div className="roll">
      <div className="rollkeys" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => { const n = hi - i; return <span key={n} className={BLACK.has(((n % 12) + 12) % 12) ? 'b' : ''}>{n % 12 === 0 ? noteName(n) : ''}</span> })}
      </div>
      <div className="rollgrid" ref={box} style={{ backgroundSize: `${100 / L}% ${100 / rows}%` }}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return
          const p = at(e)
          const add = { at: Math.max(0, Math.min(L - 0.25, Math.floor(p.beat * 4) / 4)), len: 0.5, note: p.note, vel: 100 }
          save([...notes, add]); audition(p.note)
        }}>
        {Array.from({ length: Math.ceil(L / beats) }, (_, i) => <i key={i} className="barline" style={{ left: `${((i * beats) / L) * 100}%` }} />)}
        {notes.map((n, i) => (
          <button key={i} type="button" className="rnote" aria-label={`${noteName(n.note)} at beat ${(n.at + 1).toFixed(2)}`}
            style={{ left: `${(n.at / L) * 100}%`, width: `${Math.max(0.6, (n.len / L) * 100)}%`, top: `${((hi - n.note) / rows) * 100}%`, height: `${100 / rows}%`, background: `hsl(${t.hue} 70% 50%)` }}
            onPointerDown={(e) => {
              e.stopPropagation()
              if (e.altKey) { save(notes.filter((_, j) => j !== i)); return }
              drag.current = { i, x: e.clientX, y: e.clientY, at: n.at, note: n.note }
              e.currentTarget.setPointerCapture(e.pointerId)
              audition(n.note)
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d || e.buttons !== 1) return
              const r = box.current!.getBoundingClientRect()
              const nat = Math.max(0, Math.min(L - 0.25, Math.round((d.at + ((e.clientX - d.x) / r.width) * L) * 4) / 4))
              const nn = Math.max(0, Math.min(127, d.note - Math.round(((e.clientY - d.y) / r.height) * rows)))
              if (nat !== notes[d.i].at || nn !== notes[d.i].note) save(notes.map((x, j) => (j === d.i ? { ...x, at: nat, note: nn } : x)))
            }}
            onPointerUp={() => { drag.current = null }} />
        ))}
      </div>
      <p className="rollhint">{t.name}, {L / beats} bar{L === beats ? '' : 's'}. Click to add a note, drag to move, Alt-click to remove</p>
    </div>
  )
}

/** A picture cue's layout and look, or a backing clip's start in its video. */
function CueOrMedia({ t, c, pick }: { t: Track; c: SongClip; pick: Pick }) {
  const set = (p: Partial<SongClip>) => (pick.scene ? app.setCell(t.id, pick.scene, { ...c, ...p }) : app.setClipAt(t.id, c.id, p))
  if (t.kind === 'backing') return (
    <div className="cueed"><p className="muted">{t.name}: the video plays as recorded from {c.media?.offset.toFixed(2)} s for {c.len / 4} bars.</p>
      <label className="lab">Start in the video <input type="number" step={0.1} min={0} value={c.media?.offset ?? 0} onChange={(e) => c.media && set({ media: { ...c.media, offset: Math.max(0, Number(e.target.value)) } })} /></label>
    </div>
  )
  const layouts = ['gallery', 'mosaic', 'spotlight', 'stack'] as const
  const looks = ['clean', 'framed', 'seamless', 'soft', 'signal']
  return (
    <div className="cueed">
      <fieldset className="minis labelled"><legend>Layout</legend>
        {layouts.map((l) => <button key={l} type="button" aria-pressed={c.cue?.layout === l} onClick={() => set({ cue: { ...c.cue, layout: c.cue?.layout === l ? undefined : l } })}>{l}</button>)}
      </fieldset>
      <fieldset className="minis labelled"><legend>Look</legend>
        {looks.map((l) => <button key={l} type="button" aria-pressed={c.cue?.look === l} onClick={() => set({ cue: { ...c.cue, look: c.cue?.look === l ? undefined : l } })}>{l}</button>)}
      </fieldset>
      <p className="muted">From this cue on, the stage arranges the tracks this way. Double-click a picture lane for another cue.</p>
    </div>
  )
}
