import { useEffect, useRef, useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import type { StageAspect } from '../engine/types'
import { Lens } from './glass'
import { Close, Expand, Plus } from './icons'
import { libraryItem, loadInto } from './library-load'
import { trackColor } from './palette'
import { PictureBar } from './Picture'
import { ui } from './ui'

const RATIO: Record<StageAspect, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }

/** The value a knob is turning to, over the stage for a moment, with what the picture does. */
function Hud() {
  const h = useStore(ui, (u) => u.hud)
  if (!h) return null
  // a new value remounts it, which restarts its fade (CSS): visible while turning, gone a second after
  return (
    <Lens refract={false} as="output" key={h.at} className="hud" radius={14} bezel={14} strength={34} aria-live="off">
      <span>{h.label}</span><b>{h.value}</b>{h.hint && <em>{h.hint}</em>}
    </Lens>
  )
}

type Region = { x: number; y: number; w: number; h: number }
/** The track whose tile is under a point of the stage (0-1 of the frame), if any. */
const trackAt = (x: number, y: number) => [...(app.stage?.regions ?? [])].find(([, r]) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)?.[0]

/**
 * The picture is the mixer (ADR 0773, 0776): each track's region of the split screen carries its name in
 * the track's colour, with mute and solo. A click on a tile selects the track: the keys play it and the
 * inspector edits it. The regions follow the stage's springs, so the tags slide with the tiles.
 */
function TileTags({ w, h }: { w: number; h: number }) {
  const [regions, setRegions] = useState<[string, Region][]>([])
  const tracks = useStore(app.store, (s) => s.tracks)
  const sel = useStore(app.store, (s) => s.sel)
  const sound = useStore(app.store, (s) => (s.kind === 'pads' ? `${s.pads.chains.filter((c) => c.clipId).length} pads` : s.kind === 'layers' ? `${s.layers.chains.length} layers` : s.clips.find((c) => c.id === s.clip.clipId)?.name ?? ''))
  useEffect(() => {
    let raf = 0, last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const list = [...(app.stage?.regions ?? [])]
      const key = list.map(([id, r]) => `${id}:${Math.round(r.x * w)},${Math.round(r.y * h)},${Math.round(r.w * w)},${Math.round(r.h * h)}`).join('|')
      if (key !== last) { last = key; setRegions(list) }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [w, h])
  return (
    <>
      {regions.map(([id, r]) => {
        const t = tracks.find((x) => x.id === id)
        if (!t) return null
        const small = r.w * w < 150
        return (
          <div key={id} className={`tile ${id === sel ? 'sel' : ''} ${t.mix.mute ? 'muted-t' : ''}`} style={{ left: r.x * w, top: r.y * h, width: r.w * w, height: r.h * h, ['--h' as string]: trackColor(t) }}>
            <button type="button" className="tilehit" onClick={() => { if (t.kind === 'instrument' || t.kind === 'video') app.selectTrack(id); ui.set({ picture: false, pick: null }) }} aria-label={`Select ${t.name}`} title={`${t.name}: click to play and edit it; drop a sound here to load it`} />
            <div className="tag">
              <span className="tdot" aria-hidden="true" />
              <b>{t.name}</b>{id === sel && !small && sound && <span className="tsound">{sound}</span>}
              <button type="button" className="ms" aria-pressed={t.mix.mute} onClick={() => app.setMix(id, { mute: !t.mix.mute })} title={`Mute ${t.name}`}>M</button>
              <button type="button" className="ms solo" aria-pressed={t.mix.solo} onClick={() => app.setMix(id, { solo: !t.mix.solo })} title={`Solo ${t.name}`}>S</button>
            </div>
          </div>
        )
      })}
    </>
  )
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
  const screen = useRef<HTMLDivElement>(null)

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
      const W = el.clientWidth - 20, H = el.clientHeight - 20, r = RATIO[aspect]
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
      className="stage-wrap"
      ref={wrap}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false)
        const item = libraryItem(e.dataTransfer.getData('text/x-vidaw-item'))
        if (!item) { files(e.dataTransfer.files); return }
        // a sound dropped on a tile goes into that track
        const box = screen.current?.getBoundingClientRect()
        const id = box ? trackAt((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height) : undefined
        const t = id ? app.store.get().tracks.find((x) => x.id === id) : undefined
        if (t?.kind === 'instrument') app.selectTrack(t.id)
        void loadInto(item)
      }}
    >
      <div className={`screen ${css.w < 520 ? 'narrow' : ''}`} ref={screen} style={{ width: css.w, height: css.h }}>
        <canvas ref={canvas} style={{ width: css.w, height: css.h }} aria-hidden="true" />
        {idle && <img className={`idle ${quiet ? '' : 'gone'}`} src={idle} alt="" />}
        {safe && aspect === '9:16' && <SafeZones w={css.w} h={css.h} />}
        {hasClips && <TileTags w={css.w} h={css.h} />}
        <Hud />
        {hasClips && <Lens refract={false} className="stagebtn add" radius={17} bezel={10} strength={24}><button type="button" onClick={() => file.current?.click()} title="Add a video, a .mid or a project file"><Plus size={13} />Add</button></Lens>}
        <Lens refract={false} className="stagebtn stagetoggle" radius={17} bezel={10} strength={24}><button type="button" aria-pressed={big} onClick={() => ui.set({ big: !big })} title={big ? 'Bring back the library, the inspector and the song (Option+4)' : 'The stage alone, as big as it goes (Option+4)'}><Expand size={13} /><span>{big ? 'Show everything' : 'Stage only'}</span></button></Lens>
        {hasClips && <PictureBar />}
        {hasClips && coach && !played && (
          <p className="coach">{kind === 'pads' ? <>Play the pads with <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> <kbd>V</kbd>, or click them in the inspector</> : <>Play with <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> …; <kbd>M</kbd> turns the computer keyboard on and off</>}</p>
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
    </div>
  )
}
