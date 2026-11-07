import { useEffect, useRef, useState } from 'react'
import { LOOKS } from '../engine/stage'
import { app } from '../engine/app'
import { trackColor } from './palette'
import type { LibraryItem } from '../engine/library'
import { useStore } from '../engine/store'
import { Keyboard, ScaleBar } from './Keyboard'
import { Banks, PadGrid } from './PadGrid'
import { INSTRUMENTS, ui } from './ui'


/** The pack as a strip of pictures: a click puts the sound where you are playing. */
export function SoundStrip({ onLibrary, onCamera }: { onLibrary: () => void; onCamera: () => void }) {
  const kind = useStore(app.store, (s) => s.kind)
  const clips = useStore(app.store, (s) => s.clips)
  const target = useStore(app.store, (s) => (s.kind === 'pads' ? s.clips.find((c) => c.id === s.pads.chains.find((x) => x.note === s.pads.selected)?.clipId)?.name : s.kind === 'clip' ? s.clips.find((c) => c.id === s.clip.clipId)?.name : undefined))
  const [items, setItems] = useState<LibraryItem[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { void app.library().then(setItems) }, [])
  const order = (i: LibraryItem) => (kind === 'pads' ? (i.kind === 'drum' ? 0 : 1) : i.kind === 'pitched' ? 0 : 1)
  const shown = [...items].sort((a, b) => order(a) - order(b))
  const load = async (i: LibraryItem) => {
    setBusy(i.id)
    const s = app.store.get()
    await app.loadItem(i, s.kind === 'pads' ? { pad: s.pads.selected } : undefined)
    setBusy(null)
  }
  const where = kind === 'pads' ? 'onto the selected pad' : kind === 'layers' ? 'as a new layer' : 'onto the Clip'
  return (
    <fieldset className="strip"><legend className="sr">Sounds</legend>
      <input ref={file} type="file" accept="video/*" multiple hidden onChange={(e) => { const s = app.store.get(); if (e.target.files?.length) void (s.kind === 'pads' ? app.importToPads([...e.target.files], s.pads.selected) : app.importFiles([...e.target.files])); e.target.value = '' }} />
      <button type="button" className="sbtn" onClick={() => file.current?.click()} title={`Load your own video ${where}`}>+ Video</button>
      <button type="button" className="sbtn" onClick={onCamera} title={`Record yourself ${where}`}>Camera</button>
      <div className="sounds">
        {shown.map((i) => (
          <button key={i.id} type="button" className={`sound ${target === i.name ? 'on' : ''} ${clips.some((c) => c.name === i.name) ? 'loaded' : ''}`} disabled={busy !== null} onClick={() => void load(i)} title={`${i.name}: load it ${where}`} aria-label={`${i.name}, ${i.kind === 'drum' ? 'drum' : 'instrument'}`}>
            <img src={`/library/${i.poster}`} alt="" loading="lazy" />
            <span>{busy === i.id ? '…' : i.name}</span>
          </button>
        ))}
        {!items.length && <span className="muted">The sound library appears here.</span>}
      </div>
      <button type="button" className="sbtn" onClick={onLibrary} title="The whole library">All</button>
    </fieldset>
  )
}

/** Clip, Pads or Layers for the selected track. Pads with nothing loaded fill themselves with the pack's drums. */
export function Instruments() {
  const kind = useStore(app.store, (s) => s.kind)
  const pick = (k: (typeof INSTRUMENTS)[number][0]) => {
    app.setKind(k)
    const s = app.store.get()
    if (k === 'pads' && !s.pads.chains.some((c) => c.clipId)) void app.loadKit()
    if (k === 'layers' && !s.layers.chains.length && s.clip.clipId) { app.addLayer(); app.setLayer(app.store.get().layers.chains[0].id, { clipId: s.clip.clipId }) }
  }
  return (
    <fieldset className="instruments"><legend className="sr">Instrument</legend>
      {INSTRUMENTS.map(([k, l, t]) => <button key={k} type="button" aria-pressed={kind === k} title={t} onClick={() => pick(k)}>{l}</button>)}
    </fieldset>
  )
}

/** The selected track, by name and colour, at the start of the deck's row. */
function TrackChip() {
  const t = useStore(app.store, (s) => s.tracks.find((x) => x.id === s.sel))
  if (!t) return null
  return <span className="trackchip" style={{ ['--h' as string]: trackColor(t) }} title="The selected track: the keys, pads and MIDI play it">{t.name}</span>
}

/** A video, backing or picture track has no keys: what PLAY offers for it instead. */
function OtherTrack({ kind, onCamera }: { kind: 'video' | 'backing' | 'picture'; onCamera: () => void }) {
  const file = useRef<HTMLInputElement>(null)
  const sel = useStore(app.store, (s) => s.sel)
  const pos = useStore(app.store, (s) => s.pos)
  const beats = useStore(app.store, (s) => s.transport.beats)
  const bar = Math.floor(pos / beats) + 1
  if (kind === 'picture') return (
    <div className="other">
      <p>A picture track changes the stage over time. Add a cue at bar <b>{bar}</b> (the playhead):</p>
      <div className="mrow">
        <fieldset className="minis labelled"><legend>Layout</legend>
          {(['gallery', 'mosaic', 'spotlight', 'stack'] as const).map((l) => <button key={l} type="button" onClick={() => app.addCue(sel, { layout: l })}>{l}</button>)}
        </fieldset>
        <fieldset className="minis labelled"><legend>Look</legend>
          {LOOKS.map((l) => <button key={l.id} type="button" onClick={() => app.addCue(sel, { look: l.id })}>{l.name}</button>)}
        </fieldset>
      </div>
    </div>
  )
  return (
    <div className="other">
      <input ref={file} type="file" accept="video/*,audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void app.importFiles([f], { track: sel, at: pos }); e.target.value = '' }} />
      <p>{kind === 'video'
        ? <>A video track plays its takes as recorded, each in its own tile. Film yourself along the song from bar <b>{bar}</b>, with a bar of clicks first.</>
        : <>A backing track plays a video or song as recorded, behind the tiles. It goes on the timeline at bar <b>{bar}</b> (the playhead).</>}</p>
      <div className="mrow">
        {kind === 'video' && <button type="button" className="btn rec" onClick={onCamera}><span className="dot" /> Record a take</button>}
        <button type="button" className="btn" onClick={() => file.current?.click()}>Load a video</button>
      </div>
    </div>
  )
}

export function PlayMode({ onLibrary, onCamera }: { onLibrary: () => void; onCamera: () => void }) {
  const kind = useStore(app.store, (s) => s.kind)
  const tkind = useStore(app.store, (s) => s.tracks.find((t) => t.id === s.sel)?.kind ?? 'instrument')
  const repeat = useStore(app.store, (s) => s.padPlay.repeat)
  const levels = useStore(app.store, (s) => s.padPlay.levels)
  const octave = useStore(app.store, (s) => s.octave)
  if (tkind !== 'instrument') return <div className="mode-body play other-body"><div className="mrow"><TrackChip /></div><OtherTrack kind={tkind} onCamera={onCamera} /></div>
  return (
    <div className="mode-body play">
      <div className="mrow">
        <TrackChip />
        <Instruments />
        {kind !== 'pads'
          ? <><ScaleBar /><span className="hint">Octave <b>{octave >= 0 ? `+${octave}` : octave}</b> on Z and X, velocity on C and V</span></>
          : (
            <fieldset className="minis"><legend className="sr">Pad modes</legend>
              <button type="button" aria-pressed={repeat} onClick={() => { app.setPadPlay({ repeat: !repeat }); ui.set({ page: { ...ui.get().page, 'play:pads': 'repeat' } }) }} title="Hold a pad: it repeats on the tempo grid">Note repeat</button>
              <button type="button" aria-pressed={levels} onClick={() => app.setPadPlay({ levels: !levels })} title="The block plays the selected pad at sixteen velocities">16 Levels</button>
            </fieldset>
          )}
      </div>
      <SoundStrip onLibrary={onLibrary} onCamera={onCamera} />
      {kind === 'pads'
        ? <div className="padzone"><PadGrid /><Banks /></div>
        : <Keyboard />}
    </div>
  )
}
