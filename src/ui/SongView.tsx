import { useEffect, useRef, useState } from 'react'
import { app } from '../engine/app'
import { songEnd, type SongClip, type Track, type TrackKind } from '../engine/song'
import { useStore } from '../engine/store'
import { rgb } from './format'
import { useSongTracks } from './hooks'
import { Play, Plus } from './icons'
import { trackThumb } from './thumbs'
import { ui, type Pick } from './ui'

const GLYPH: Record<TrackKind, string> = { instrument: '♪', video: '●', backing: '▤', picture: '◧' }
const KINDS: [TrackKind, string, string][] = [
  ['instrument', 'Instrument', 'Notes that play clips: Clip, Pads or Layers'],
  ['video', 'Video', 'Film yourself along the click: each take plays as recorded, in its own tile'],
  ['backing', 'Backing', 'A video or song played as recorded under everything'],
  ['picture', 'Picture', 'Cues that change the layout and the look over time'],
]
const hue = (t: Track, l = 55, a = 1) => `hsl(${t.hue} 70% ${l}% / ${a})`

/** A clip's notes as a small piano roll, in the track's colour. */
function Notes({ c, t, w }: { c: SongClip; t: Track; w: number }) {
  if (!c.notes.length) return null
  const lo = Math.min(...c.notes.map((n) => n.note)), hi = Math.max(...c.notes.map((n) => n.note))
  const reps = Math.max(1, Math.ceil(c.len / c.loop - 1e-9))
  return (
    <svg className="notes" viewBox={`0 0 ${w} 100`} preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: reps }, (_, k) => c.notes.filter((n) => k * c.loop + n.at < c.len).slice(0, 200).map((n, i) => (
        <rect key={`${k}:${i}`} x={((k * c.loop + n.at) / c.len) * w} width={Math.max(1.5, (Math.min(n.len, c.len - k * c.loop - n.at) / c.len) * w - 0.5)}
          y={hi > lo ? 80 - ((n.note - lo) / (hi - lo)) * 64 : 40} height={16} rx={2} fill={hue(t, 38)} opacity={k ? 0.55 : 0.95} />
      )))}
    </svg>
  )
}

/** A track's header: colour, kind, name, mute and solo; a click selects it (the keys play it). */
function TrackHead({ t, sel }: { t: Track; sel: boolean }) {
  const clips = useStore(app.store, (s) => s.clips)
  const [renaming, setRenaming] = useState(false)
  const thumb = t.kind === 'picture' ? undefined : trackThumb(t, clips)
  return (
    <div className={`thead ${sel ? 'sel' : ''}`} style={{ ['--h' as string]: hue(t) }}>
      <button type="button" className="thbtn" aria-pressed={sel} onClick={() => (t.kind === 'instrument' || t.kind === 'video' ? app.selectTrack(t.id) : ui.set({ pick: null }))} onDoubleClick={() => setRenaming(true)} title={`${t.name}: ${KINDS.find((k) => k[0] === t.kind)?.[2]}`}>
        <span className="tthumb" style={{ background: thumb ? `${rgb(thumb.poster)} url(${thumb.thumb}) center / cover` : undefined }}>{!thumb && GLYPH[t.kind]}</span>
        {renaming
          ? <input className="tname" defaultValue={t.name} aria-label="Track name" ref={(e) => e?.select()} onBlur={(e) => { app.setTrack(t.id, { name: e.target.value || t.name }); setRenaming(false) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false) }} />
          : <span className="tname">{t.name}</span>}
      </button>
      <button type="button" className="ms" aria-pressed={t.mix.mute} onClick={() => app.setMix(t.id, { mute: !t.mix.mute })} title="Mute">M</button>
      <button type="button" className="ms solo" aria-pressed={t.mix.solo} onClick={() => app.setMix(t.id, { solo: !t.mix.solo })} title="Solo">S</button>
    </div>
  )
}

function AddTrack() {
  const [open, setOpen] = useState(false)
  return (
    <div className="addtrack">
      <button type="button" className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}><Plus size={13} />Track</button>
      {open && (
        <div className="menu" role="menu">
          {KINDS.map(([k, l, d]) => (
            <button key={k} type="button" role="menuitem" onClick={() => { app.addTrack(k); setOpen(false) }}><b>{GLYPH[k]} {l}</b><span>{d}</span></button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The board: tracks as rows, scenes as columns, each cell a loop. A scene launches on the next bar. */
function Board({ tracks }: { tracks: Track[] }) {
  const scenes = useStore(app.store, (x) => x.scenes), sceneOn = useStore(app.store, (x) => x.sceneOn), queued = useStore(app.store, (x) => x.queuedScene)
  const selId = useStore(app.store, (x) => x.sel), songRec = useStore(app.store, (x) => x.songRec)
  const s = { scenes, sceneOn, queued, sel: selId, songRec }
  const pick = useStore(ui, (u) => u.pick)
  const clips = useStore(app.store, (x) => x.clips)
  const beat = useStore(app.clock, (c) => c.beat)
  const songOn = useStore(app.store, (x) => x.songOn)
  return (
    <section className="board2" aria-label="The board: tracks and scenes" style={{ gridTemplateColumns: `180px repeat(${s.scenes.length}, 118px) 70px` }}>
      <div className="corner"><AddTrack /></div>
      {s.scenes.map((sc, i) => (
        <div key={sc.id} className={`scene ${s.sceneOn === sc.id && songOn === 'board' ? 'on' : ''} ${s.queued === sc.id ? 'queued' : ''}`}>
          <button type="button" className="launch2" onClick={() => app.launchScene(sc.id)} title={`Play scene ${sc.name} (key ${i + 1}); while the board plays it starts on the next bar`}><Play size={11} /><b>{sc.name}</b></button>
          <button type="button" className="place" onClick={() => app.placeScene(sc.id)} title={`Put scene ${sc.name} on the timeline, at the song's end`}>Add to song</button>
        </div>
      ))}
      <div><button type="button" className="addscene" onClick={() => app.addScene()} title="A new scene" aria-label="Add a scene"><Plus size={14} /></button></div>
      {tracks.map((t) => (
        <div key={t.id} className="brow">
          <div className="rhead"><TrackHead t={t} sel={t.id === s.sel} /></div>
          {s.scenes.map((sc) => {
            const c = t.cells[sc.id]
            const picked = pick?.track === t.id && pick.scene === sc.id
            const playing = s.sceneOn === sc.id && songOn === 'board'
            const thumb = c && t.kind !== 'picture' ? trackThumb(t, clips, c) : undefined
            const rec = playing && s.songRec === 'board' && t.id === s.sel
            return (
              <div key={sc.id} className={`bcell ${c ? 'full' : ''} ${picked ? 'picked' : ''} ${playing ? 'playing' : ''} ${rec ? 'rec' : ''}`} style={{ ['--h' as string]: hue(t), ['--hl' as string]: hue(t, 55, 0.16) }}>
                <button type="button" className="cellbtn"
                  onClick={() => { if (t.kind === 'instrument' || t.kind === 'video') app.selectTrack(t.id); ui.set({ pick: c ? { track: t.id, scene: sc.id } : null }) }}
                  onDoubleClick={() => { if (!c && (t.kind === 'instrument' || t.kind === 'video')) { app.selectTrack(t.id); app.store.set({ view: 'board' }); app.launchScene(sc.id); if (!app.store.get().songRec) app.songRecord() } }}
                  title={c ? `${t.name}, scene ${sc.name}: ${c.len / 4} bar${c.len === 4 ? '' : 's'}${c.notes.length ? `, ${c.notes.length} notes` : ''}` : t.kind === 'instrument' || t.kind === 'video' ? `Empty: double-click to record ${t.name} into scene ${sc.name}` : 'Empty'}
                  aria-label={c ? `${t.name}, scene ${sc.name}` : `${t.name}, scene ${sc.name}, empty`}>
                  {thumb && <span className="cthumb" style={{ background: `${rgb(thumb.poster)} url(${thumb.thumb}) center / cover` }} />}
                  {c?.cue && <span className="cue">{[c.cue.layout, c.cue.look].filter(Boolean).join(', ')}</span>}
                  {c && <Notes c={c} t={t} w={100} />}
                  {playing && c && <i className="phase" style={{ width: `${((beat % c.loop) / c.loop) * 100}%` }} />}
                  {rec && <span className="recdot" />}
                </button>
              </div>
            )
          })}
          <div />
        </div>
      ))}
    </section>
  )
}

/** The timeline: tracks as rows, bars across. Drag a clip to move it, its right edge to stretch it. */
function Timeline({ tracks }: { tracks: Track[] }) {
  const ppb = useStore(ui, (u) => u.ppb)
  const pick = useStore(ui, (u) => u.pick)
  const sel = useStore(app.store, (x) => x.sel)
  const marks = useStore(app.store, (x) => x.marks)
  const beats = useStore(app.store, (x) => x.transport.beats)
  const pos = useStore(app.store, (x) => x.pos)
  const songOn = useStore(app.store, (x) => x.songOn)
  const songRec = useStore(app.store, (x) => x.songRec)
  const clips = useStore(app.store, (x) => x.clips)
  const beat = useStore(app.clock, (c) => c.beat)
  const scroller = useRef<HTMLDivElement>(null)
  const drag = useRef<{ track: string; id: string; mode: 'move' | 'len'; x: number; start: number; len: number } | null>(null)
  const end = songEnd(tracks)
  const total = Math.max(end + beats * 8, beats * 16)
  const head = songOn === 'timeline' ? beat : pos
  // the playhead stays in view while the song plays
  useEffect(() => {
    const el = scroller.current
    if (!el || songOn !== 'timeline') return
    const x = 180 + head * ppb
    if (x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = x - 200
  }, [head, ppb, songOn])
  const snap = (b: number, fine: boolean) => (fine ? Math.round(b * 4) / 4 : Math.round(b))
  const atX = (e: React.PointerEvent | React.MouseEvent, el: HTMLElement) => (e.clientX - el.getBoundingClientRect().left) / ppb
  return (
    <div className="tl" ref={scroller}>
      <div className="tlinner" style={{ width: 180 + total * ppb }}>
        <div className="ruler">
          <div className="corner"><AddTrack /></div>
          <div className="bars" onPointerDown={(e) => app.setPos(Math.max(0, Math.round(atX(e, e.currentTarget))))} title="Click to move the playhead">
            {Array.from({ length: Math.ceil(total / beats) }, (_, i) => <span key={i} style={{ left: i * beats * ppb, width: beats * ppb }}>{i + 1}</span>)}
            {marks.map((m, i) => <i key={i} className="mark" style={{ left: m.at * ppb, width: m.len * ppb }}>{m.scene}</i>)}
          </div>
        </div>
        {tracks.map((t) => (
          <div key={t.id} className={`lane ${t.id === sel ? 'sel' : ''}`} style={{ ['--h' as string]: hue(t), ['--hl' as string]: hue(t, 55, 0.18) }}>
            <TrackHead t={t} sel={t.id === sel} />
            <div className="lanebody" style={{ backgroundSize: `${beats * ppb}px 100%` }}
              onDoubleClick={(e) => {
                const b = Math.floor(atX(e, e.currentTarget) / beats) * beats
                if (t.kind === 'picture') app.addCue(t.id, { layout: app.store.get().trackLayout }, b)
                else if (t.kind === 'instrument') { app.store.set((s) => ({ tracks: s.tracks.map((x) => (x.id === t.id ? { ...x, clips: [...x.clips, { id: `c${Date.now().toString(36)}`, start: b, len: beats, loop: beats, notes: [] }].sort((a, c) => a.start - c.start) } : x)) })); app.selectTrack(t.id) }
              }}>
              {t.clips.map((c) => {
                const thumb = t.kind !== 'picture' ? trackThumb(t, clips, c) : undefined
                const picked = pick?.track === t.id && pick.clip === c.id
                return (
                  <div key={c.id} className={`tclip ${picked ? 'picked' : ''} k-${t.kind}`} style={{ left: c.start * ppb, width: Math.max(6, c.len * ppb - 1) }}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      if (t.kind === 'instrument' || t.kind === 'video') app.selectTrack(t.id)
                      ui.set({ pick: { track: t.id, clip: c.id } as Pick })
                      const edge = e.clientX > e.currentTarget.getBoundingClientRect().right - 8
                      drag.current = { track: t.id, id: c.id, mode: edge ? 'len' : 'move', x: e.clientX, start: c.start, len: c.len }
                      e.currentTarget.setPointerCapture(e.pointerId)
                    }}
                    onPointerMove={(e) => {
                      const d = drag.current
                      if (!d || e.buttons !== 1) return
                      const db = (e.clientX - d.x) / ppb
                      if (d.mode === 'move') app.setClipAt(d.track, d.id, { start: Math.max(0, snap(d.start + db, e.altKey)) })
                      else app.setClipAt(d.track, d.id, { len: Math.max(e.altKey ? 0.25 : 1, snap(d.len + db, e.altKey)) })
                    }}
                    onPointerUp={() => { drag.current = null }}
                    title={`${t.name}: drag to move (Alt: finer), drag the right edge to stretch; Delete removes it`}>
                    {thumb && <span className="strip" style={{ backgroundImage: `url(${thumb.thumb})`, backgroundColor: rgb(thumb.poster) }} />}
                    {c.cue && <span className="cue">{[c.cue.layout, c.cue.look].filter(Boolean).join(', ')}</span>}
                    <Notes c={c} t={t} w={Math.max(6, c.len * ppb)} />
                  </div>
                )
              })}
              {songRec === 'timeline' && t.id === sel && <i className="recband" style={{ left: pos * ppb, width: Math.max(0, (head - pos) * ppb) }} />}
            </div>
          </div>
        ))}
        <i className="playhead" style={{ left: 180 + head * ppb }} />
      </div>
    </div>
  )
}

/** Board and timeline: two views of one song (Tab switches). */
export function SongView() {
  const view = useStore(app.store, (s) => s.view)
  const shown = useSongTracks()
  const ppb = useStore(ui, (u) => u.ppb)
  const pick = useStore(ui, (u) => u.pick)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      if (e.code === 'Tab' && !e.metaKey && !e.altKey && !e.ctrlKey) { e.preventDefault(); app.store.set((s) => ({ view: s.view === 'board' ? 'timeline' : 'board' })) }
      const p = ui.get().pick
      if (p && (e.code === 'Delete' || e.code === 'Backspace')) {
        e.preventDefault()
        if (p.scene) app.setCell(p.track, p.scene, null); else if (p.clip) app.setClipAt(p.track, p.clip, null)
        ui.set({ pick: null })
      }
      if (p?.clip && e.code === 'KeyD' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const t = app.store.get().tracks.find((x) => x.id === p.track), c = t?.clips.find((x) => x.id === p.clip)
        if (t && c) { const copy = { ...structuredClone(c), id: `c${Date.now().toString(36)}`, start: c.start + c.len }; app.store.set((s) => ({ tracks: s.tracks.map((x) => (x.id === t.id ? { ...x, clips: [...x.clips, copy].sort((a, b) => a.start - b.start) } : x)) })); ui.set({ pick: { track: t.id, clip: copy.id } }) }
      }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  return (
    <section className="songview" aria-label="The song">
      <header className="svhead">
        <fieldset className="minis"><legend className="sr">View</legend>
          <button type="button" aria-pressed={view === 'board'} onClick={() => app.store.set({ view: 'board' })} title="Jam: scenes of loops (Tab)">Board</button>
          <button type="button" aria-pressed={view === 'timeline'} onClick={() => app.store.set({ view: 'timeline' })} title="Arrange: the song on bars (Tab)">Timeline</button>
        </fieldset>
        <span className="hint">{view === 'board' ? 'Double-click an empty cell to record into it. Play a scene from its name; Add to song puts it on the timeline.' : 'Click the ruler to move the playhead; double-click a lane for a new clip; Delete removes, ⌘D duplicates.'}</span>
        {view === 'timeline' && <label className="zoom" title="Zoom">− <input type="range" min={8} max={64} value={ppb} onChange={(e) => ui.set({ ppb: Number(e.target.value) })} aria-label="Zoom" /> +</label>}
        {pick && <button type="button" className="btn sm" onClick={() => ui.set({ pick: null })}>Deselect</button>}
      </header>
      {view === 'board' ? <Board tracks={shown} /> : <Timeline tracks={shown} />}
    </section>
  )
}
