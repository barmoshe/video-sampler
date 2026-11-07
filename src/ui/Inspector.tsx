import { useRef } from 'react'
import { app } from '../engine/app'
import { LOOKS } from '../engine/stage'
import type { Track } from '../engine/song'
import { useStore } from '../engine/store'
import { panText } from './format'
import { Close } from './icons'
import { KnobGrid, KnobTargetName } from './Knobs'
import { trackColor } from './palette'
import { PianoRoll } from './PianoRoll'
import { PictureDetail } from './Picture'
import { InstrumentDetail } from './InstrumentDetail'
import { ScaleBar } from './ScaleBar'
import { INSTRUMENTS, ui } from './ui'

const KIND_LABEL: Record<Track['kind'], string> = { instrument: 'Instrument track', video: 'Video track', backing: 'Backing track', picture: 'Picture track' }

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

/** How the computer keyboard and MIDI play the track: the scale and chord, the octave and velocity. */
function PlayRow() {
  const kind = useStore(app.store, (s) => s.kind)
  const octave = useStore(app.store, (s) => s.octave)
  const velocity = useStore(app.store, (s) => s.velocity)
  const keysOn = useStore(app.store, (s) => s.keysOn)
  return (
    <div className="playrow">
      {kind !== 'pads' && <ScaleBar />}
      <span className="hint">{!keysOn ? <>The computer keyboard is off: <b>M</b> turns it on</> : kind === 'pads' ? <>Pads on <b>Z X C V</b>, <b>A S D F</b>, <b>Q W E R</b>, <b>1 2 3 4</b></> : <>Octave <b>{octave >= 0 ? `+${octave}` : octave}</b> on Z X, velocity <b>{velocity}</b> on C V</>}</span>
    </div>
  )
}

/** The selected track's level, place, mute and solo: the mix, where the track is. */
function TrackMix({ t }: { t: Track }) {
  return (
    <fieldset className="tmix"><legend className="sr">{t.name}: mix</legend>
      <label className="tfader" title="Volume (double-click: 0 dB); the tile dims with it">
        <span>Vol</span>
        <input type="range" min={-48} max={6} step={0.5} value={t.mix.volume} aria-label={`${t.name} volume`} aria-valuetext={`${t.mix.volume} dB`}
          onChange={(e) => app.setMix(t.id, { volume: Number(e.target.value) })} onDoubleClick={() => app.setMix(t.id, { volume: 0 })} />
        <b>{t.mix.volume > 0 ? '+' : ''}{t.mix.volume.toFixed(1)}</b>
      </label>
      <label className="tfader pan" title="Pan (double-click: centre)">
        <span>Pan</span>
        <input type="range" min={-1} max={1} step={0.05} value={t.mix.pan} aria-label={`${t.name} pan`} aria-valuetext={panText(t.mix.pan)}
          onChange={(e) => app.setMix(t.id, { pan: Number(e.target.value) })} onDoubleClick={() => app.setMix(t.id, { pan: 0 })} />
        <b>{panText(t.mix.pan)}</b>
      </label>
      <button type="button" className="ms" aria-pressed={t.mix.mute} onClick={() => app.setMix(t.id, { mute: !t.mix.mute })} title="Mute">M</button>
      <button type="button" className="ms solo" aria-pressed={t.mix.solo} onClick={() => app.setMix(t.id, { solo: !t.mix.solo })} title="Solo">S</button>
    </fieldset>
  )
}

/** A video, backing or picture track has no keys: what it offers instead. */
function OtherTrack({ t, onCamera }: { t: Track; onCamera: () => void }) {
  const file = useRef<HTMLInputElement>(null)
  const pos = useStore(app.store, (s) => s.pos)
  const beats = useStore(app.store, (s) => s.transport.beats)
  const bar = Math.floor(pos / beats) + 1
  if (t.kind === 'picture') return (
    <div className="other">
      <p>A picture track changes the stage over time. Add a cue at bar <b>{bar}</b> (the playhead):</p>
      <fieldset className="choice"><legend className="lab">Layout</legend>
        {(['gallery', 'mosaic', 'spotlight', 'stack'] as const).map((l) => <button key={l} type="button" onClick={() => app.addCue(t.id, { layout: l })}>{l}</button>)}
      </fieldset>
      <fieldset className="choice looks"><legend className="lab">Look</legend>
        {LOOKS.map((l) => <button key={l.id} type="button" onClick={() => app.addCue(t.id, { look: l.id })}>{l.name}</button>)}
      </fieldset>
    </div>
  )
  return (
    <div className="other">
      <input ref={file} type="file" accept="video/*,audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void app.importFiles([f], { track: t.id, at: pos }); e.target.value = '' }} />
      <p>{t.kind === 'video'
        ? <>A video track plays its takes as recorded, each in its own tile. Film yourself along the song from bar <b>{bar}</b>, with a bar of clicks first.</>
        : <>A backing track plays a video or song as recorded, behind the tiles. It goes on the timeline at bar <b>{bar}</b> (the playhead).</>}</p>
      <div className="row">
        {t.kind === 'video' && <button type="button" className="btn rec" onClick={onCamera}><span className="dot" /> Record a take</button>}
        <button type="button" className="btn" onClick={() => file.current?.click()}>Load a video</button>
      </div>
    </div>
  )
}

/**
 * The inspector (ADR 0776): whatever is selected, edited in one place. A track (its instrument's eight
 * knobs, its mix, its sample, pads or layers), a clip picked in the song (its notes), or the picture.
 */
export function Inspector({ onCamera }: { onCamera: () => void }) {
  const s = useStore(app.store, (x) => x)
  const u = useStore(ui, (x) => x)
  const t = s.tracks.find((x) => x.id === s.sel)
  const pt = u.pick ? s.tracks.find((x) => x.id === u.pick?.track) : undefined
  const pickName = pt && u.pick ? `${pt.name}, ${u.pick.scene ? `scene ${s.scenes.find((x) => x.id === u.pick?.scene)?.name ?? ''}` : `bar ${Math.floor((pt.clips.find((c) => c.id === u.pick?.clip)?.start ?? 0) / s.transport.beats) + 1}`}` : ''
  return (
    <aside className="insp" aria-label="Inspector" style={{ ['--h' as string]: u.picture ? 'var(--accent)' : t ? trackColor(t) : 'var(--accent)' }}>
      {u.pick && pt ? (
        <>
          <header className="insp-head">
            <span className="swatch" aria-hidden="true" />
            <div className="ititle"><b>{pickName}</b><small>{pt.kind === 'picture' ? 'Cues' : pt.kind === 'instrument' ? 'Notes: click to add, drag to move, Alt-click to remove' : 'Media'}</small></div>
            <button type="button" className="x" aria-label="Back to the track" onClick={() => ui.set({ pick: null })}><Close size={14} /></button>
          </header>
          <div className="insp-body notes-body"><PianoRoll pick={u.pick} /></div>
        </>
      ) : u.picture ? (
        <>
          <header className="insp-head">
            <span className="swatch" aria-hidden="true" />
            <div className="ititle"><b>The picture</b><small>How the tracks and their notes share the frame</small></div>
            <button type="button" className="x" aria-label="Back to the track" onClick={() => ui.set({ picture: false })}><Close size={14} /></button>
          </header>
          <div className="insp-body"><PictureDetail /><KnobGrid /></div>
        </>
      ) : t ? (
        <>
          <header className="insp-head">
            <span className="swatch" aria-hidden="true" />
            <div className="ititle"><b>{t.name}</b><small>{t.kind === 'instrument' ? <KnobTargetName /> : KIND_LABEL[t.kind]}</small></div>
          </header>
          <div className="insp-body">
            {t.kind === 'instrument' && <><Instruments /><PlayRow /></>}
            <KnobGrid />
            <TrackMix t={t} />
            {t.kind === 'instrument' ? <InstrumentDetail /> : <OtherTrack t={t} onCamera={onCamera} />}
          </div>
        </>
      ) : <p className="muted pad">Select a track.</p>}
    </aside>
  )
}
