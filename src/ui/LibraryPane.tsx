import { useEffect, useRef, useState } from 'react'
import { app } from '../engine/app'
import type { LibraryItem } from '../engine/library'
import { useStore } from '../engine/store'
import { Camera, Plus } from './icons'
import { loadInto, remember } from './library-load'

const KINDS: [LibraryItem['kind'] | 'all', string][] = [['all', 'All'], ['pitched', 'Tuned'], ['drum', 'Drums']]

/**
 * The library (ADR 0776): sounds as pictures, the way a VJ deck shows clips. A click loads one into the
 * selected track; drag one onto a tile of the stage to load it into that track. Your own videos and the
 * camera sit on top.
 */
export function LibraryPane({ onCamera, onLibrary }: { onCamera: () => void; onLibrary: () => void }) {
  const kind = useStore(app.store, (s) => s.kind)
  const clips = useStore(app.store, (s) => s.clips)
  const target = useStore(app.store, (s) => (s.kind === 'pads' ? s.clips.find((c) => c.id === s.pads.chains.find((x) => x.note === s.pads.selected)?.clipId)?.name : s.kind === 'clip' ? s.clips.find((c) => c.id === s.clip.clipId)?.name : undefined))
  const track = useStore(app.store, (s) => s.tracks.find((t) => t.id === s.sel)?.name)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [filter, setFilter] = useState<LibraryItem['kind'] | 'all'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { void app.library().then((x) => { remember(x); setItems(x) }) }, [])
  const order = (i: LibraryItem) => (kind === 'pads' ? (i.kind === 'drum' ? 0 : 1) : i.kind === 'pitched' ? 0 : 1)
  const shown = items.filter((i) => filter === 'all' || i.kind === filter).sort((a, b) => order(a) - order(b))
  const where = kind === 'pads' ? 'onto the selected pad' : kind === 'layers' ? 'as a new layer' : 'onto the Clip'
  const load = async (i: LibraryItem) => { setBusy(i.id); await loadInto(i); setBusy(null) }
  return (
    <aside className="lib" aria-label="Library">
      <header className="lib-head">
        <b>Library</b>
        <fieldset className="minis"><legend className="sr">Kind</legend>
          {KINDS.map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
        </fieldset>
      </header>
      <div className="lib-own">
        <input ref={file} type="file" accept="video/*" multiple hidden onChange={(e) => { const s = app.store.get(); if (e.target.files?.length) void (s.kind === 'pads' ? app.importToPads([...e.target.files], s.pads.selected) : app.importFiles([...e.target.files])); e.target.value = '' }} />
        <button type="button" className="btn sm" onClick={() => file.current?.click()} title={`Load your own video ${where}`}><Plus size={12} />Your video</button>
        <button type="button" className="btn sm" onClick={onCamera} title={`Record yourself ${where}`}><Camera size={13} />Camera</button>
      </div>
      <p className="lib-where">Into <b>{track ?? 'the track'}</b>, {where}</p>
      <div className="lib-grid">
        {shown.map((i) => (
          <button key={i.id} type="button" draggable className={`litem ${target === i.name ? 'on' : ''} ${clips.some((c) => c.name === i.name) ? 'loaded' : ''}`} disabled={busy !== null}
            onClick={() => void load(i)} onDragStart={(e) => { e.dataTransfer.setData('text/x-vidaw-item', i.id); e.dataTransfer.effectAllowed = 'copy' }}
            title={`${i.name}: click to load it ${where}, or drag it onto a tile`} aria-label={`${i.name}, ${i.kind === 'drum' ? 'drum' : 'tuned'}`}>
            <img src={`/library/${i.poster}`} alt="" loading="lazy" draggable={false} />
            <span>{busy === i.id ? 'Loading' : i.name}</span>
          </button>
        ))}
        {!items.length && <p className="muted">The sound library appears here.</p>}
      </div>
      <button type="button" className="lib-all" onClick={onLibrary}>The whole library and the drum kit</button>
    </aside>
  )
}
