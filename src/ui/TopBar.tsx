import { useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import { MIDI_NOTE, support } from '../engine/support'
import { Meter } from './Meter'
import { INSTRUMENTS, setMode } from './ui'

/** Clip, Pads or Layers. Pads with nothing loaded fill themselves with the pack's drum kit. */
function Instruments() {
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

/** The slim bar over the stage: the instrument, the transport, record and capture, undo, and settings. */
export function TopBar({ onSettings, onLibrary, onAbout }: { onSettings: () => void; onLibrary: () => void; onAbout: () => void }) {
  const recording = useStore(app.store, (s) => s.recording)
  const looping = useStore(app.store, (s) => s.looping)
  const bpm = useStore(app.store, (s) => s.transport.bpm)
  const bars = useStore(app.store, (s) => s.transport.bars)
  const bar = useStore(app.store, (s) => s.bar)
  const canUndo = useStore(app.store, (s) => s.canUndo)
  const canRedo = useStore(app.store, (s) => s.canRedo)
  const midi = useStore(app.store, (s) => s.midiDevices)
  const savedAt = useStore(app.store, (s) => s.savedAt)
  const takes = useStore(app.store, (s) => s.takes.length)
  const [can] = useState(support)
  return (
    <header className="top">
      <button type="button" className="brand" onClick={onAbout} title="About, keys and licences">video<b>·</b>sampler</button>
      <Instruments />
      <span className="spacer" />
      <fieldset className="transport-mini"><legend className="sr">Transport</legend>
        <button type="button" className="tbtn" aria-pressed={looping} onClick={() => (looping ? app.loopStop() : app.loopStart())} title="Play or stop the loops">{looping ? '■' : '▶'}</button>
        <button type="button" className="tempo" onClick={() => setMode('loop')} title="Tempo and loops (LOOP mode)"><b>{bpm}</b> BPM</button>
        <span className="beats" aria-hidden="true">{Array.from({ length: bars }, (_, i) => <i key={i} className={looping && bar === i ? 'on' : ''} />)}</span>
      </fieldset>
      <button type="button" className="btn rec" aria-pressed={recording} onClick={() => app.toggleRecord()} title="Record a take (Enter)"><span className="dot" />{recording ? 'Stop' : 'Rec'}</button>
      <button type="button" className="btn" disabled={recording} onClick={() => app.capture()} title="Keep what you just played as a take, without having pressed Rec (Shift+Enter)">Capture</button>
      {takes > 0 && <button type="button" className="btn ghost" onClick={() => setMode('post')} title="Your takes, ready to export">{takes} take{takes > 1 ? 's' : ''}</button>}
      <span className="sep" />
      <button type="button" className="icon" disabled={!canUndo} onClick={() => app.undo()} title="Undo (⌘Z)" aria-label="Undo"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3 2 6l3 3" /><path d="M2.5 6H10a4 4 0 0 1 0 8H7" /></svg></button>
      <button type="button" className="icon" disabled={!canRedo} onClick={() => app.redo()} title="Redo (⇧⌘Z)" aria-label="Redo"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m11 3 3 3-3 3" /><path d="M13.5 6H6a4 4 0 0 0 0 8h3" /></svg></button>
      <Meter />
      <button type="button" className="icon wide" onClick={onLibrary} title="The sound and video library">Library</button>
      <button type="button" className="icon wide" disabled={!can.midi} onClick={() => app.connectMidi()} title={can.midi ? (midi?.length ? `MIDI: ${midi.join(', ')}` : 'Connect MIDI keyboards and Ableton (IAC)') : MIDI_NOTE}>
        <span className={`dot ${midi?.length ? 'blue' : 'off'}`} />MIDI
      </button>
      <button type="button" className="icon" onClick={onSettings} aria-label="Settings" title={savedAt ? `Settings · saved ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Settings'}>⚙</button>
    </header>
  )
}
