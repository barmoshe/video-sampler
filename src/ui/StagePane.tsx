import { useEffect, useRef, useState } from 'react'
import { app } from '../engine/app'
import { homeKey } from '../engine/instruments'
import { useStore } from '../engine/store'
import type { StageAspect } from '../engine/types'
import { noteName } from '../engine/voice-math'
import { ClipPanel } from './ClipPanel'
import { LayersPanel } from './LayersPanel'
import { PadsPanel } from './PadsPanel'
import { Lens } from './glass'
import { Close, Expand, Plus } from './icons'
import { ui } from './ui'

const RATIO: Record<StageAspect, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }

/** The value a knob is turning to, over the stage for a moment, with what the picture does. */
function Hud() {
  const h = useStore(ui, (u) => u.hud)
  if (!h) return null
  // a new value remounts it, which restarts its fade (CSS): visible while turning, gone a second after
  return (
    <Lens as="output" key={h.at} className="hud" radius={14} bezel={14} strength={34} aria-live="off">
      <span>{h.label}</span><b>{h.value}</b>{h.hint && <em>{h.hint}</em>}
    </Lens>
  )
}

/** What is playing, in the stage's corner: the instrument and its sound. */
function Badge() {
  const kind = useStore(app.store, (s) => s.kind)
  const clipP = useStore(app.store, (s) => s.clip)
  const clip = useStore(app.store, (s) => s.clips.find((c) => c.id === s.clip.clipId))
  const pads = useStore(app.store, (s) => s.pads.chains.filter((c) => c.clipId).length)
  const layers = useStore(app.store, (s) => s.layers.chains.length)
  const voices = useStore(app.store, (s) => s.voices)
  const text = kind === 'clip'
    ? clip ? `${clip.name}${clipP.mode !== 'slice' ? `, home ${noteName(homeKey(clipP, clip))}` : ', sliced'}` : 'no clip'
    : kind === 'pads' ? `${pads} pad${pads === 1 ? '' : 's'} loaded` : `${layers} layer${layers === 1 ? '' : 's'}`
  return <Lens className="badge" radius={10} bezel={9} strength={22}><b>{kind}</b><span>{text}</span>{voices > 0 && <span className="v">{voices} on stage</span>}</Lens>
}

/** Where Reels, TikTok and Shorts put their buttons and captions over a 9:16 frame. */
function SafeZones({ w, h }: { w: number; h: number }) {
  return (
    <div className="safe" style={{ width: w, height: h }} aria-hidden="true">
      <i className="s-top"><span>app bar</span></i>
      <i className="s-right"><span>buttons</span></i>
      <i className="s-bottom"><span>caption</span></i>
    </div>
  )
}

/** Every setting for the instrument, as a sheet over the stage (the knobs show eight at a time). */
function Sheet({ onCamera }: { onCamera: () => void }) {
  const kind = useStore(app.store, (s) => s.kind)
  return (
    <aside className="sheet" aria-label="Every setting">
      <header><b>Every setting for the {kind}</b><button type="button" className="x" aria-label="Close" onClick={() => ui.set({ sheet: false })}><Close size={14} /></button></header>
      <div className="sheet-body">
        {kind === 'clip' && <ClipPanel onCamera={onCamera} />}
        {kind === 'pads' && <PadsPanel onCamera={onCamera} />}
        {kind === 'layers' && <LayersPanel />}
      </div>
    </aside>
  )
}

export function StagePane({ onCamera, onLibrary }: { onCamera: () => void; onLibrary: () => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const aspect = useStore(app.store, (s) => s.aspect)
  const hasClips = useStore(app.store, (s) => s.clips.length > 0)
  const importing = useStore(app.store, (s) => s.importing)
  const starting = useStore(app.store, (s) => s.starting)
  const exporting = useStore(app.store, (s) => s.exporting)
  const message = useStore(app.store, (s) => s.message)
  const played = useStore(app.store, (s) => s.active.length > 0)
  const mode = useStore(ui, (u) => u.mode)
  const sheet = useStore(ui, (u) => u.sheet)
  const safe = useStore(ui, (u) => u.safe)
  const coach = useStore(ui, (u) => u.coach)
  const big = useStore(ui, (u) => u.big)
  const kind = useStore(app.store, (s) => s.kind)
  const quiet = useStore(app.store, (s) => s.voices === 0 && !s.songOn && !s.playing)
  // an idle stage shows what is loaded, dimmed, so the instrument looks on before the first note
  const idle = useStore(app.store, (s) => s.clips.find((c) => c.id === (s.kind === 'pads' ? s.pads.chains.find((x) => x.note === s.pads.selected)?.clipId : s.kind === 'layers' ? s.layers.chains[0]?.clipId : s.clip.clipId))?.thumb)
  const [over, setOver] = useState(false)
  const [css, setCss] = useState({ w: 640, h: 360 })
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => app.attachStage(canvas.current!), [])
  useEffect(() => { if (played && coach) ui.set({ coach: false }) }, [played, coach])
  useEffect(() => { // a message goes by itself after a while (an error stays a little longer)
    if (!message) return
    const t = setTimeout(() => { if (app.store.get().message === message) app.say(null) }, /could not|failed|error/i.test(message) ? 9000 : 5000)
    return () => clearTimeout(t)
  }, [message])

  // fit the stage's shape into the pane; the canvas renders at device pixels (capped at 1920)
  useEffect(() => {
    const el = wrap.current!
    const fit = () => {
      const W = el.clientWidth - 32, H = el.clientHeight - 28, r = RATIO[aspect]
      const w = Math.max(64, Math.min(W, H * r)), h = w / r
      setCss({ w, h })
      const dpr = Math.min(2, devicePixelRatio || 1)
      const scale = Math.min(dpr, 1920 / Math.max(w, h))
      app.stage?.resize(Math.round(w * scale), Math.round(h * scale))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [aspect])

  const files = (list: FileList | null) => { if (list?.length) void app.importFiles([...list]) }

  return (
    <div
      className={`stage-wrap ${sheet ? 'with-sheet' : ''}`}
      ref={wrap}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); files(e.dataTransfer.files) }}
    >
      <div className="screen" style={{ width: css.w, height: css.h }}>
        <canvas ref={canvas} style={{ width: css.w, height: css.h }} aria-hidden="true" />
        {idle && <img className={`idle ${quiet ? '' : 'gone'}`} src={idle} alt="" />}
        {mode === 'post' && safe && aspect === '9:16' && <SafeZones w={css.w} h={css.h} />}
        {hasClips && <Badge />}
        <Hud />
        {hasClips && <Lens className="stagebtn add" radius={17} bezel={10} strength={24}><button type="button" onClick={() => file.current?.click()} title="Add a video, a .mid or a project file"><Plus size={13} />Add</button></Lens>}
        <Lens className="stagebtn stagetoggle" radius={17} bezel={10} strength={24}><button type="button" aria-pressed={big} onClick={() => ui.set({ big: !big })} title={big ? 'Show the song beside the stage' : 'The stage alone, as big as it goes'}><Expand size={13} />{big ? 'Show the song' : 'Stage only'}</button></Lens>
        {hasClips && coach && !played && mode === 'play' && (
          <p className="coach">{kind === 'pads' ? <>Play the pads with <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> <kbd>V</kbd>, or click them</> : <>Play with <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> … or click the keys</>}</p>
        )}
        {!hasClips && !importing && !starting && (
          <div className="empty">
            <h1>Play a video like an instrument.</h1>
            <p>Every key plays the clip at its own pitch, picture and sound together. Pick a sound below, or bring your own video.</p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => file.current?.click()}>Choose a video</button>
              <button type="button" className="btn" onClick={onCamera}>Record with the camera</button>
              <button type="button" className="btn" onClick={onLibrary}>Open the library</button>
            </div>
            <p className="small">Or drop a video, a .mid or a project file here. Your clips stay on this computer.</p>
          </div>
        )}
      </div>
      <input ref={file} type="file" accept="video/*,.mid,.midi,.vsamp" multiple hidden onChange={(e) => { files(e.target.files); e.target.value = '' }} />
      {over && <div className="drop-hint">Drop to load</div>}
      {importing && (
        <output className="progress">
          {importing.stage}: {importing.name}
          <span className="bar"><i style={{ width: `${Math.round(importing.progress * 100)}%` }} /></span>
        </output>
      )}
      {exporting && (
        <output className="progress">
          Exporting: {exporting.stage}
          <span className="bar"><i style={{ width: `${Math.round(exporting.progress * 100)}%` }} /></span>
        </output>
      )}
      {message && (
        <div className="toast" role="alert">
          <span>{message}</span>
          <button type="button" className="x" aria-label="Dismiss" onClick={() => app.say(null)}><Close size={14} /></button>
        </div>
      )}
      {sheet && (mode === 'play' || mode === 'shape') && <Sheet onCamera={onCamera} />}
    </div>
  )
}
