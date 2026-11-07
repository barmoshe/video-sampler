import { useEffect, useRef, useState } from 'react'
import { app } from '../engine/app'
import type { LibraryItem } from '../engine/library'
import { useStore } from '../engine/store'
import { Keyboard, ScaleBar } from './Keyboard'
import { Banks, PadGrid } from './PadGrid'
import { ui } from './ui'


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

export function PlayMode({ onLibrary, onCamera }: { onLibrary: () => void; onCamera: () => void }) {
  const kind = useStore(app.store, (s) => s.kind)
  const repeat = useStore(app.store, (s) => s.padPlay.repeat)
  const levels = useStore(app.store, (s) => s.padPlay.levels)
  const octave = useStore(app.store, (s) => s.octave)
  return (
    <div className="mode-body play">
      <div className="mrow">
        {kind !== 'pads'
          ? <><ScaleBar /><span className="hint">octave <b>{octave >= 0 ? `+${octave}` : octave}</b> · Z X · velocity C V</span></>
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
