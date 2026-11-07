import { useEffect, useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import { Dialog } from './Dialog'
import type { LibraryItem } from '../engine/library'

const KINDS: [LibraryItem['kind'] | 'all', string][] = [['all', 'All'], ['pitched', 'Instruments'], ['drum', 'Drums'], ['loop', 'Loops'], ['video', 'Videos']]

/** The pack: pick a sound for the Clip, a pad or a new layer, or load the whole drum kit onto pads. */
export function LibraryDialog({ onClose }: { onClose: () => void }) {
  const kind = useStore(app.store, (s) => s.kind)
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [filter, setFilter] = useState<LibraryItem['kind'] | 'all'>('all')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void app.library().then(setItems) }, [])

  const pick = async (item: LibraryItem) => {
    setBusy(true)
    const s = app.store.get()
    await app.loadItem(item, s.kind === 'pads' ? { pad: s.pads.selected } : undefined)
    setBusy(false)
    onClose()
  }
  const kit = async () => {
    setBusy(true)
    app.setKind('pads')
    await app.loadKit()
    setBusy(false)
    onClose()
  }

  const shown = (items ?? []).filter((i) => filter === 'all' || i.kind === filter)
  return (
    <Dialog
      title="Library"
      onClose={onClose}
      footer={<>
        <span className="muted" style={{ marginRight: 'auto' }}>CC0 recordings (VCSL) with artwork made for them. Credits: <a href="/library/CREDITS.md" target="_blank" rel="noreferrer">CREDITS</a></span>
        <button type="button" className="btn" disabled={busy || !(items ?? []).some((i) => i.kind === 'drum')} onClick={() => void kit()}>Load the drum kit onto pads</button>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </>}
    >
      <fieldset className="seg"><legend className="sr">Kind</legend>
        {KINDS.map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
      </fieldset>
      {items === null && <p className="muted">Loading the library…</p>}
      {items && !items.length && <p className="muted">The library is being made: its clips appear here when the pack is ready.</p>}
      <div className="libgrid">
        {shown.map((i) => (
          <button key={i.id} type="button" className="libitem" disabled={busy} onClick={() => void pick(i)} title={`Load ${i.name} ${kind === 'pads' ? 'onto the selected pad' : kind === 'layers' ? 'as a new layer' : 'onto the Clip'}`}>
            <img src={`/library/${i.poster}`} alt="" loading="lazy" />
            <span>{i.name}</span>
            <span className="muted">{i.duration.toFixed(1)} s</span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}
