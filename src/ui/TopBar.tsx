import { useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import { MIDI_NOTE, support } from '../engine/support'
import { Export, Gear, Keys, Metronome, Midi, Play, Rec, Redo, SidebarLeft, SidebarRight, Stop, Undo } from './icons'
import { Lens } from './glass'
import { Mark } from './Logo'
import { Meter } from './Meter'
import { togglePane, ui } from './ui'

/** The toolbar's glass: refracted at the rim, then a light frost so the wallpaper's colour comes through. */
const FROST = 'blur(7px) saturate(190%) brightness(1.04)'

/**
 * The LCD (after Logic's): where the song is, large, with its tempo and metre beside it. On the board it
 * shows the playing scene and the bar inside it.
 */
function Lcd() {
  const beat = useStore(app.clock, (c) => c.beat)
  const tr = useStore(app.store, (s) => s.transport)
  const sceneOn = useStore(app.store, (s) => s.sceneOn)
  const songOn = useStore(app.store, (s) => s.songOn)
  const bar = Math.floor(beat / tr.beats) + 1, b = Math.floor(beat % tr.beats) + 1
  const sixteenth = Math.floor((beat % 1) * 4) + 1
  return (
    <Lens as="fieldset" className="lcd" radius={19} bezel={11} strength={20} frost={FROST}><legend className="sr">Position and tempo</legend>
      <div className="lcd-pos" title="Bar, beat and sixteenth">
        {songOn === 'board' && sceneOn ? <span className="lcd-scene">{sceneOn}</span> : null}
        <span className="lcd-big">{bar}</span><span className="lcd-dot">.</span><span className="lcd-big">{b}</span><span className="lcd-dot">.</span><span className="lcd-small">{sixteenth}</span>
      </div>
      <label className="lcd-field" title="Tempo">
        <input type="number" min={40} max={240} value={tr.bpm} disabled={!!songOn} aria-label="Tempo in BPM" onChange={(e) => app.setTransport({ bpm: Math.max(40, Math.min(240, Number(e.target.value) || tr.bpm)) })} />
        <span>bpm</span>
      </label>
      <span className="lcd-field" title="Beats in a bar"><b>{tr.beats}/4</b></span>
    </Lens>
  )
}

/**
 * The window's toolbar, macOS style (ADR 0775, 0776): the library's toggle and the song on the leading
 * side, the transport and the LCD in the middle, then history, takes, Export (the one tinted action) and
 * the inspector's toggle. Its background drags the window in the desktop app; leading space is left for
 * the traffic lights there.
 */
export function TopBar({ onSettings, onAbout, onTakes, onExport }: { onSettings: () => void; onAbout: () => void; onTakes: () => void; onExport: () => void }) {
  const songOn = useStore(app.store, (s) => s.songOn)
  const songRec = useStore(app.store, (s) => s.songRec)
  const view = useStore(app.store, (s) => s.view)
  const recording = useStore(app.store, (s) => s.recording)
  const metronome = useStore(app.store, (s) => s.transport.metronome)
  const canUndo = useStore(app.store, (s) => s.canUndo)
  const canRedo = useStore(app.store, (s) => s.canRedo)
  const midi = useStore(app.store, (s) => s.midiDevices)
  const savedAt = useStore(app.store, (s) => s.savedAt)
  const takes = useStore(app.store, (s) => s.takes.length)
  const track = useStore(app.store, (s) => s.tracks.find((t) => t.id === s.sel)?.name)
  const songLen = useStore(app.store, (s) => s.tracks.some((t) => t.clips.length))
  const keysOn = useStore(app.store, (s) => s.keysOn)
  const panes = useStore(ui, (u) => u.panes)
  const big = useStore(ui, (u) => u.big)
  const [can] = useState(support)
  return (
    <header className="top">
      <div className="tb-lead">
        <button type="button" className="tb-btn pane" aria-pressed={panes.lib && !big} onClick={() => togglePane('lib')} title="Show or hide the library (Option+1)" aria-label="Library"><SidebarLeft /></button>
        <button type="button" className="brand" onClick={onAbout} title="About VIDAW, the keys and the licences" aria-label="VIDAW: about, keys and licences">
          <span className="appicon" aria-hidden="true"><Mark size={11} /></span>
          <span className="tb-title"><b>Untitled song</b><small>{savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'VIDAW'}</small></span>
        </button>
      </div>
      <div className="tb-center">
        <Lens as="fieldset" className="tb-group transport" radius={19} bezel={11} strength={20} frost={FROST}><legend className="sr">Transport</legend>
          <button type="button" className="tb-btn" aria-pressed={!!songOn} onClick={() => (songOn ? app.songStop() : app.songStart(view))} title={songOn ? 'Stop (Space)' : `Play the ${view} (Space)`} aria-label={songOn ? 'Stop' : 'Play'}>{songOn ? <Stop /> : <Play />}</button>
          <button type="button" className="tb-btn rec" aria-pressed={!!songRec} onClick={() => app.songRecord()} title={`Record into ${track ?? 'the selected track'} (\` or Enter)`} aria-label="Record into the song"><Rec /></button>
          <button type="button" className="tb-btn" aria-pressed={metronome} onClick={() => app.setTransport({ metronome: !metronome })} title="Metronome" aria-label="Metronome"><Metronome /></button>
        </Lens>
        <Lcd />
      </div>
      <div className="tb-trail">
        <Lens as="fieldset" className="tb-group" radius={19} bezel={11} strength={20} frost={FROST}><legend className="sr">History</legend>
          <button type="button" className="tb-btn" disabled={!canUndo} onClick={() => app.undo()} title="Undo (⌘Z)" aria-label="Undo"><Undo /></button>
          <button type="button" className="tb-btn" disabled={!canRedo} onClick={() => app.redo()} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo /></button>
        </Lens>
        <Meter />
        <Lens as="fieldset" className="tb-group" radius={19} bezel={11} strength={20} frost={FROST}><legend className="sr">Takes</legend>
          {recording && <button type="button" className="tb-btn text rec" aria-pressed onClick={() => app.toggleRecord()} title="Stop recording the take">Stop take</button>}
          <button type="button" className="tb-btn text" disabled={recording} onClick={() => app.capture()} title="Keep what you just played as a take (Shift+Enter)">Capture</button>
          <button type="button" className="tb-btn text dim" onClick={onTakes} title="Your takes" aria-label={`${takes} takes`}>{takes}</button>
        </Lens>
        <Lens as="fieldset" className="tb-group primary" radius={19} bezel={11} strength={20} frost={FROST}><legend className="sr">Export</legend>
          <button type="button" className="tb-btn text" disabled={!songLen || recording} onClick={onExport} title={songLen ? 'The song as an MP4, in the shape, layout and look on the stage' : 'Put a scene on the timeline first'}><Export />Export</button>
        </Lens>
        <Lens as="fieldset" className="tb-group" radius={19} bezel={11} strength={20} frost={FROST}><legend className="sr">Computer keyboard, MIDI and settings</legend>
          <button type="button" className={`tb-btn ${keysOn ? 'lit' : ''}`} aria-pressed={keysOn} onClick={() => app.setKeys(!keysOn)} title={keysOn ? 'The computer keyboard plays notes (M)' : 'Play notes from the computer keyboard (M)'} aria-label="Computer keyboard"><Keys /></button>
          <button type="button" className={`tb-btn ${midi?.length ? 'lit' : ''}`} disabled={!can.midi} onClick={() => app.connectMidi()} title={can.midi ? (midi?.length ? `MIDI: ${midi.join(', ')}` : 'Connect MIDI keyboards and Ableton (IAC)') : MIDI_NOTE} aria-label="MIDI"><Midi /></button>
          <button type="button" className="tb-btn" onClick={onSettings} aria-label="Settings" title="Settings"><Gear /></button>
        </Lens>
        <button type="button" className="tb-btn pane" aria-pressed={panes.insp && !big} onClick={() => togglePane('insp')} title="Show or hide the inspector (Option+2)" aria-label="Inspector"><SidebarRight /></button>
      </div>
    </header>
  )
}
