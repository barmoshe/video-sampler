import { useRef } from 'react'
import { app } from '../engine/app'
import type { Transport } from '../engine/looper'
import { useStore } from '../engine/store'

/**
 * The transport and the looper (ADR 0771): tempo, bars, metronome, count-in, quantise; record layers
 * (one per pass, each its own tile), undo / redo, mute, clear; and the main video behind the tiles.
 */
export function LoopBar() {
  const tr = useStore(app.store, (s) => s.transport)
  const looping = useStore(app.store, (s) => s.looping)
  const loopRec = useStore(app.store, (s) => s.loopRec)
  const layers = useStore(app.store, (s) => s.loopLayers)
  const redo = useStore(app.store, (s) => s.redoLayers)
  const bar = useStore(app.store, (s) => s.bar)
  const main = useStore(app.store, (s) => s.main)
  const clips = useStore(app.store, (s) => s.clips)
  const taps = useRef<number[]>([])
  const set = (p: Partial<Transport>) => app.setTransport(p)

  const tap = () => {
    const now = performance.now()
    taps.current = [...taps.current.filter((t) => now - t < 2500), now]
    if (taps.current.length < 2) return
    const gaps = taps.current.slice(1).map((t, i) => t - taps.current[i])
    set({ bpm: Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)) })
  }

  return (
    <div className="loopbar" role="toolbar" aria-label="Looper">
      <button type="button" className="btn" aria-pressed={looping} onClick={() => (looping ? app.loopStop() : app.loopStart())} title="Start or stop the loops and the metronome">
        {looping ? '■ Stop' : '▶ Loop'}
      </button>
      <button type="button" className="btn rec" aria-pressed={loopRec} onClick={() => app.loopRecord()} title="Record a layer on every pass until pressed again (key `)">
        <span className="dot" /> {loopRec ? 'Recording layers' : 'Rec layer'}
      </button>
      <button type="button" className="btn" disabled={!layers.length} onClick={() => app.loopUndo()} title="Remove the last layer">Undo</button>
      <button type="button" className="btn" disabled={!redo.length} onClick={() => app.loopRedo()} title="Bring it back">Redo</button>
      <button type="button" className="btn" disabled={!layers.length && !looping} onClick={() => app.loopClear()}>Clear</button>
      <span className="bars" aria-label={`Bar ${bar + 1} of ${tr.bars}`}>
        {Array.from({ length: tr.bars }, (_, i) => <i key={i} className={looping && bar === i ? 'on' : looping && bar < 0 ? 'count' : ''} />)}
      </span>
      <label className="num">BPM <input type="number" min={40} max={240} value={tr.bpm} onChange={(e) => set({ bpm: Math.max(40, Math.min(240, Number(e.target.value) || tr.bpm)) })} /></label>
      <button type="button" className="btn" onClick={tap} title="Tap the tempo">Tap</button>
      <label className="num">Bars
        <select value={tr.bars} onChange={(e) => set({ bars: Number(e.target.value) })}>{[1, 2, 4, 8].map((b) => <option key={b} value={b}>{b}</option>)}</select>
      </label>
      <label className="num">Grid
        <select value={tr.quantize} onChange={(e) => set({ quantize: Number(e.target.value) as Transport['quantize'] })}>
          <option value={0}>Free</option><option value={2}>1/8</option><option value={4}>1/16</option><option value={3}>1/8 T</option>
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={tr.metronome} onChange={(e) => set({ metronome: e.target.checked })} />Click</label>
      <label className="check"><input type="checkbox" checked={tr.countIn} onChange={(e) => set({ countIn: e.target.checked })} />Count-in</label>
      <span className="layerchips" aria-label="Layers">
        {layers.map((l, i) => (
          <button type="button" key={l.id} className="chip" aria-pressed={!l.muted} onClick={() => app.muteLayer(l.id)} title={`${l.notes.length} notes; click to ${l.muted ? 'unmute' : 'mute'}`}>L{i + 1}</button>
        ))}
      </span>
      <span className="spacer" />
      <label className="num">Main video
        <select value={main.clipId ?? ''} onChange={(e) => app.setMain({ clipId: e.target.value || null })}>
          <option value="">None</option>
          {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {main.clipId && (
        <label className="num">Sound <input type="range" min={0} max={1} step={0.05} value={main.gain} onChange={(e) => app.setMain({ gain: Number(e.target.value) })} /></label>
      )}
    </div>
  )
}
