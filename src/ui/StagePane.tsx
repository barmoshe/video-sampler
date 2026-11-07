import { useEffect, useRef, useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import type { StageAspect } from '../engine/types'

const RATIO: Record<StageAspect, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }

export function StagePane({ onCamera, onLibrary }: { onCamera: () => void; onLibrary: () => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const aspect = useStore(app.store, (s) => s.aspect)
  const hasClips = useStore(app.store, (s) => s.clips.length > 0)
  const importing = useStore(app.store, (s) => s.importing)
  const exporting = useStore(app.store, (s) => s.exporting)
  const message = useStore(app.store, (s) => s.message)
  const [over, setOver] = useState(false)
  const [css, setCss] = useState({ w: 640, h: 360 })
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => app.attachStage(canvas.current!), [])

  // fit the stage's shape into the pane; the canvas renders at device pixels (capped at 1920)
  useEffect(() => {
    const el = wrap.current!
    const fit = () => {
      const W = el.clientWidth - 24, H = el.clientHeight - 24, r = RATIO[aspect]
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
      onDrop={(e) => { e.preventDefault(); setOver(false); files(e.dataTransfer.files) }}
    >
      <canvas ref={canvas} style={{ width: css.w, height: css.h }} aria-hidden="true" />
      <input ref={file} type="file" accept="video/*,.mid,.midi,.vsamp" multiple hidden onChange={(e) => { files(e.target.files); e.target.value = '' }} />
      {!hasClips && !importing && (
        <div className="overlay">
          <div className="empty">
            <h1>Play a video like an instrument.</h1>
            <p>Every key plays the clip at its own pitch, picture and sound together, and every note you hold joins the picture.</p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => file.current?.click()}>Choose a video</button>
              <button type="button" className="btn" onClick={onCamera}>Record with the camera</button>
              <button type="button" className="btn" onClick={onLibrary}>Open the library</button>
              <button type="button" className="btn" onClick={() => void app.loadDemo()}>Try a demo clip</button>
            </div>
            <p className="small">Or drop a video, a .mid or a project file anywhere here. Then play with the keys A to ' or a MIDI keyboard. Your clips stay on this computer.</p>
          </div>
        </div>
      )}
      {over && <div className="drop-hint">Drop to load</div>}
      {importing && (
        <output className="progress">
          {importing.stage}: {importing.name}
          <span className="bar"><i style={{ width: `${Math.round(importing.progress * 100)}%` }} /></span>
        </output>
      )}
      {exporting && (
        <output className="progress">
          Exporting · {exporting.stage}
          <span className="bar"><i style={{ width: `${Math.round(exporting.progress * 100)}%` }} /></span>
        </output>
      )}
      {message && (
        <div className="toast" role="alert">
          <span>{message}</span>
          <button type="button" className="x" aria-label="Dismiss" onClick={() => app.say(null)}>×</button>
        </div>
      )}
      {hasClips && <button type="button" className="btn" style={{ position: 'absolute', right: 10, top: 10 }} onClick={() => file.current?.click()}>+ Add clip</button>}
    </div>
  )
}
