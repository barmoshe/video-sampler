import { useEffect, useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import type { LayoutMode, StageAspect } from '../engine/types'
import { CameraDialog } from './CameraDialog'
import { ClipPanel } from './ClipPanel'
import { ExportDialog } from './ExportDialog'
import { Keyboard } from './Keyboard'
import { LayersPanel } from './LayersPanel'
import { LibraryDialog } from './LibraryDialog'
import { LoopBar } from './LoopBar'
import { PadsPanel } from './PadsPanel'
import { SettingsDialog } from './SettingsDialog'
import { StagePane } from './StagePane'

const LAYOUTS: [LayoutMode, string][] = [['gallery', 'Gallery'], ['keys', 'Keys'], ['stack', 'Stack'], ['mosaic', 'Mosaic'], ['spotlight', 'Spotlight'], ['home', 'Home grid']]
const ASPECTS: [StageAspect, string][] = [['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']]

export function App() {
  const s = useStore(app.store, (x) => x)
  const [dialog, setDialog] = useState<'export' | 'camera' | 'settings' | 'library' | null>(null)
  useEffect(() => app.attachKeyboard(), [])

  const layout = s.layouts[s.kind]
  return (
    <div className={`app ${s.kind === 'pads' ? 'pads' : ''}`}>
      <header className="top">
        <div className="brand">video<b>·</b>sampler</div>
        <fieldset className="tabs"><legend className="sr">Instrument</legend>
          {(['clip', 'pads', 'layers'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={s.kind === k} onClick={() => app.setKind(k)} title={k === 'clip' ? 'One clip across the keyboard' : k === 'pads' ? 'One clip per pad' : 'Clips layered and split by key, velocity and selector'}>
              {k === 'clip' ? 'Clip' : k === 'pads' ? 'Pads' : 'Layers'}
            </button>
          ))}
        </fieldset>
        <button type="button" className="btn" onClick={() => setDialog('library')} title="The built-in sounds and videos">Library</button>
        <div className="spacer" />
        <select aria-label="Layout" value={layout} onChange={(e) => app.setLayout(e.target.value as LayoutMode)}>
          {LAYOUTS.filter(([m]) => m !== 'home' || s.kind === 'pads').map(([m, l]) => <option key={m} value={m}>{l}</option>)}
        </select>
        <select aria-label="Stage shape" value={s.aspect} onChange={(e) => app.set('aspect', e.target.value as StageAspect)}>
          {ASPECTS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
        </select>
        <button type="button" className="btn rec" aria-pressed={s.recording} onClick={() => app.toggleRecord()} title="Record a take (Enter)">
          <span className="dot" /> {s.recording ? 'Stop' : 'Record'}
        </button>
        <button type="button" className="btn" disabled={!s.take || s.recording} onClick={() => (s.playing ? app.stopTake() : app.playTake())}>
          {s.playing ? '■ Stop' : '▶ Play take'}
        </button>
        <button type="button" className="btn primary" disabled={!s.take || s.recording} onClick={() => setDialog('export')}>Export MP4</button>
        <button type="button" className="btn" onClick={() => app.connectMidi()} title="Connect MIDI keyboards and Ableton (IAC)">
          <span className={`dot ${s.midiDevices?.length ? 'blue' : 'off'}`} /> MIDI
        </button>
        <button type="button" className="btn" onClick={() => setDialog('settings')} aria-label="Settings">⚙</button>
      </header>

      <div className="main">
        <StagePane onCamera={() => setDialog('camera')} onLibrary={() => setDialog('library')} />
        <aside className="side" aria-label="Instrument settings">
          {s.kind === 'clip' && <ClipPanel onCamera={() => setDialog('camera')} />}
          {s.kind === 'pads' && <PadsPanel onCamera={() => setDialog('camera')} />}
          {s.kind === 'layers' && <LayersPanel />}
        </aside>
      </div>

      <LoopBar />
      {s.kind !== 'pads' ? <Keyboard /> : <div />}

      <footer className="status" aria-live="polite">
        <span><b>{s.voices}</b> on stage</span>
        <span>{s.kind === 'pads' ? <>pads <b>Z X C V · A S D F · Q W E R · 1 2 3 4</b></> : <>keys <b>A–'</b> · octave <b>Z X</b> {s.octave >= 0 ? `+${s.octave}` : s.octave} · velocity <b>C V</b> {s.velocity}</>}</span>
        <span>sustain <b>Space</b> · bend <b>↑ ↓</b> · record <b>Enter</b></span>
        <span>{s.midiDevices === null ? 'MIDI not connected' : s.midiDevices.length ? `MIDI: ${s.midiDevices.join(', ')}` : 'MIDI: no inputs'}{s.bpm ? ` · clock ${s.bpm} BPM` : ''}</span>
        {s.take && <span>take <b>{s.take.duration.toFixed(1)} s</b> · <button type="button" className="x" style={{ fontSize: 11 }} onClick={() => app.downloadMidi()}>save .mid</button></span>}
      </footer>

      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'camera' && <CameraDialog onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'library' && <LibraryDialog onClose={() => setDialog(null)} />}
    </div>
  )
}
