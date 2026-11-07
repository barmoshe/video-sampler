import { useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import { MIDI_NOTE, support } from '../engine/support'
import { Gear, Library as LibraryIcon, Midi, Play, Rec, Redo, Stop, Undo } from './icons'
import { Logo } from './Logo'
import { Meter } from './Meter'
import { setMode } from './ui'

/** Where the song is: bar.beat on the timeline, or the bar inside the playing scene. */
function Position() {
  const beat = useStore(app.clock, (c) => c.beat)
  const beats = useStore(app.store, (s) => s.transport.beats)
  const sceneOn = useStore(app.store, (s) => s.sceneOn)
  const songOn = useStore(app.store, (s) => s.songOn)
  const bar = Math.floor(beat / beats) + 1, b = Math.floor(beat % beats) + 1
  return <span className="posn" title="Bar and beat">{songOn === 'board' && sceneOn ? <b className="scn">{sceneOn}</b> : null}<b>{bar}</b>.{b}</span>
}

/** The slim bar over the stage: the song's transport, record, capture, undo and settings. */
export function TopBar({ onSettings, onLibrary, onAbout }: { onSettings: () => void; onLibrary: () => void; onAbout: () => void }) {
  const songOn = useStore(app.store, (s) => s.songOn)
  const songRec = useStore(app.store, (s) => s.songRec)
  const view = useStore(app.store, (s) => s.view)
  const recording = useStore(app.store, (s) => s.recording)
  const tr = useStore(app.store, (s) => s.transport)
  const canUndo = useStore(app.store, (s) => s.canUndo)
  const canRedo = useStore(app.store, (s) => s.canRedo)
  const midi = useStore(app.store, (s) => s.midiDevices)
  const savedAt = useStore(app.store, (s) => s.savedAt)
  const takes = useStore(app.store, (s) => s.takes.length)
  const track = useStore(app.store, (s) => s.tracks.find((t) => t.id === s.sel)?.name)
  const [can] = useState(support)
  return (
    <header className="top">
      <button type="button" className="brand" onClick={onAbout} title="About VIDAW, the keys and the licences" aria-label="VIDAW: about, keys and licences"><Logo /></button>
      <fieldset className="transport-mini"><legend className="sr">Transport</legend>
        <button type="button" className="tbtn" aria-pressed={!!songOn} onClick={() => (songOn ? app.songStop() : app.songStart(view))} title={songOn ? 'Stop' : `Play the ${view}`} aria-label={songOn ? 'Stop' : 'Play'}>{songOn ? <Stop /> : <Play />}</button>
        <button type="button" className="tbtn rec" aria-label="Record into the song" aria-pressed={!!songRec} onClick={() => app.songRecord()} title={`Record into ${track ?? 'the selected track'}: the ${view === 'board' ? "playing scene's cell, overdubbing each pass" : 'timeline from the playhead'} (\` or Enter)`}><Rec /></button>
        <Position />
        <label className="bpm" title="Tempo">
          <input type="number" min={40} max={240} value={tr.bpm} disabled={!!songOn} aria-label="Tempo in BPM" onChange={(e) => app.setTransport({ bpm: Math.max(40, Math.min(240, Number(e.target.value) || tr.bpm)) })} /> BPM
        </label>
        <button type="button" className="tclick" aria-pressed={tr.metronome} onClick={() => app.setTransport({ metronome: !tr.metronome })} title="The metronome">Click</button>
      </fieldset>
      <span className="spacer" />
      <button type="button" className="btn" aria-pressed={recording} onClick={() => app.toggleRecord()} title="Record a performance take (not into the song)">{recording ? 'Stop take' : 'Take'}</button>
      <button type="button" className="btn" disabled={recording} onClick={() => app.capture()} title="Keep what you just played as a take, without having pressed record (Shift+Enter)">Capture</button>
      {takes > 0 && <button type="button" className="btn ghost" onClick={() => setMode('post')} title="Your takes, ready to export">{takes} take{takes > 1 ? 's' : ''}</button>}
      <span className="sep" />
      <button type="button" className="icon" disabled={!canUndo} onClick={() => app.undo()} title="Undo (⌘Z)" aria-label="Undo"><Undo /></button>
      <button type="button" className="icon" disabled={!canRedo} onClick={() => app.redo()} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo /></button>
      <Meter />
      <button type="button" className="icon wide" onClick={onLibrary} title="The sound and video library"><LibraryIcon />Library</button>
      <button type="button" className="icon wide" disabled={!can.midi} onClick={() => app.connectMidi()} title={can.midi ? (midi?.length ? `MIDI: ${midi.join(', ')}` : 'Connect MIDI keyboards and Ableton (IAC)') : MIDI_NOTE}>
        <Midi style={{ color: midi?.length ? 'var(--blue)' : undefined }} />MIDI
      </button>
      <button type="button" className="icon" onClick={onSettings} aria-label="Settings" title={savedAt ? `Settings (saved at ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : 'Settings'}><Gear /></button>
    </header>
  )
}
