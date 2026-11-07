import { useRef } from 'react'
import { app } from '../engine/app'
import type { Layer } from '../engine/looper'
import { useStore } from '../engine/store'
import { rgb } from './format'

/** A layer's notes as a strip of ticks across its loop (in beats): what it plays, at a glance. */
function Ticks({ layer, length }: { layer: Layer; length: number }) {
  const lo = Math.min(...layer.notes.map((n) => n.note)), hi = Math.max(...layer.notes.map((n) => n.note))
  return (
    <span className="ticks" aria-hidden="true">
      {layer.notes.slice(0, 64).map((n, i) => (
        <i key={i} style={{ left: `${(n.at / length) * 100}%`, width: `${Math.max(1.2, (n.len / length) * 100)}%`, bottom: `${hi > lo ? ((n.note - lo) / (hi - lo)) * 70 : 35}%` }} />
      ))}
    </span>
  )
}

/**
 * The loop board (ADR 0771, 0772): each column a section with its main video and its layers, launched
 * on the next bar; each cell a recorded layer that loops as its own tile. Record adds a layer to the
 * section that is playing.
 */
export function LoopMode() {
  const tr = useStore(app.store, (s) => s.transport)
  const looping = useStore(app.store, (s) => s.looping)
  const loopRec = useStore(app.store, (s) => s.loopRec)
  const layers = useStore(app.store, (s) => s.loopLayers)
  const redo = useStore(app.store, (s) => s.redoLayers)
  const bar = useStore(app.store, (s) => s.bar)
  const main = useStore(app.store, (s) => s.main)
  const section = useStore(app.store, (s) => s.section)
  const others = useStore(app.store, (s) => s.sections)
  const queued = useStore(app.store, (s) => s.queued)
  const clips = useStore(app.store, (s) => s.clips)
  const taps = useRef<number[]>([])
  const length = tr.bars * tr.beats
  const cols = [{ id: section, layers, main }, ...others.map((x) => ({ id: x.id, layers: x.layers, main: x.main }))].sort((a, b) => a.id.localeCompare(b.id))
  const tap = () => {
    const now = performance.now()
    taps.current = [...taps.current.filter((t) => now - t < 2500), now]
    if (taps.current.length < 2) return
    const gaps = taps.current.slice(1).map((t, i) => t - taps.current[i])
    app.setTransport({ bpm: Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)) })
  }
  const clipOf = (id: string | null) => clips.find((c) => c.id === id)
  return (
    <div className="mode-body loop">
      <div className="transport">
        <div className="tbtns">
          <button type="button" className="big" aria-pressed={looping} onClick={() => (looping ? app.loopStop() : app.loopStart())} title="Start or stop the loops and the metronome">{looping ? '■' : '▶'}<small>{looping ? 'Stop' : 'Play'}</small></button>
          <button type="button" className="big rec" aria-pressed={loopRec} onClick={() => app.loopRecord()} title="Record a layer on every pass until pressed again (key `)"><span className="dot" /><small>{loopRec ? 'Layering' : 'Layer'}</small></button>
        </div>
        <span className="bars">
          <span className="sr">{looping ? `Bar ${bar + 1} of ${tr.bars}` : `${tr.bars} bars`}</span>
          {Array.from({ length: tr.bars }, (_, i) => <i key={i} aria-hidden="true" className={looping && bar === i ? 'on' : looping && bar < 0 ? 'count' : ''} />)}
        </span>
        <div className="trow">
          <button type="button" className="btn sm" disabled={!layers.length} onClick={() => app.loopUndo()} title="Remove the last layer">Undo</button>
          <button type="button" className="btn sm" disabled={!redo.length} onClick={() => app.loopRedo()}>Redo</button>
          <button type="button" className="btn sm" disabled={!layers.length && !looping} onClick={() => app.loopClear()}>Clear</button>
        </div>
        <div className="trow">
          <button type="button" className="btn sm" onClick={tap} title="Tap the tempo">Tap</button>
          <button type="button" className="toggle" aria-pressed={tr.metronome} onClick={() => app.setTransport({ metronome: !tr.metronome })}>Click</button>
          <button type="button" className="toggle" aria-pressed={tr.countIn} onClick={() => app.setTransport({ countIn: !tr.countIn })}>Count-in</button>
        </div>
      </div>

      <section className="board" aria-label="Sections and layers">
        {cols.map((c, ci) => {
          const mv = clipOf(c.main.clipId)
          const current = c.id === section
          return (
            <div key={c.id} className={`col ${current ? 'cur' : ''} ${queued === c.id ? 'queued' : ''}`}>
              <button type="button" className="launch" aria-pressed={current} onClick={() => app.switchSection(c.id)} title={`Section ${c.id} (key ${ci + 1})${looping ? ': starts on the next bar' : ''}`}>
                {mv && <img src={mv.thumb} alt="" style={{ background: rgb(mv.poster) }} />}
                <b>{c.id}</b><span>{c.layers.length} layer{c.layers.length === 1 ? '' : 's'}</span>
              </button>
              <div className="cells">
                {c.layers.map((l, i) => (
                  <button key={l.id} type="button" className={`cell ${l.muted ? 'muted' : ''}`} aria-pressed={current && !l.muted}
                    onClick={() => (current ? app.muteLayer(l.id) : app.switchSection(c.id))}
                    title={current ? `Layer ${i + 1}, ${l.notes.length} notes: click to ${l.muted ? 'unmute' : 'mute'}` : `Go to section ${c.id}`}>
                    <span className="cn">L{i + 1}</span><Ticks layer={l} length={length} />
                  </button>
                ))}
                {current && (
                  <button type="button" className={`cell add ${loopRec ? 'on' : ''}`} onClick={() => app.loopRecord()}>
                    <span className="dot" />{loopRec ? 'Recording…' : 'Record a layer'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {cols.length < 8 && <button type="button" className="col addcol" onClick={() => app.addSection()} title="A new section: its own layers, main video and layout">+ Section</button>}
      </section>

      <div className="mainvid">
        <span className="lab">Main video{cols.length > 1 ? ` · ${section}` : ''}</span>
        <select aria-label="Main video" value={main.clipId ?? ''} onChange={(e) => app.setMain({ clipId: e.target.value || null })}>
          <option value="">None</option>
          {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {main.clipId && (
          <fieldset className="minis"><legend className="sr">Where it shows</legend>
            {([['behind', 'Behind'], ['side', 'Beside'], ['pip', 'Corner']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={main.place === v} onClick={() => app.setMain({ place: v })}>{l}</button>)}
          </fieldset>
        )}
      </div>
    </div>
  )
}
