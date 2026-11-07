import { app } from '../engine/app'
import { LOOKS } from '../engine/stage'
import { useStore } from '../engine/store'
import type { Take } from '../engine/take'
import type { LayoutMode, StageAspect } from '../engine/types'
import { Close, Play, Stop } from './icons'
import { ui } from './ui'

const LAYOUTS: [LayoutMode, string][] = [['gallery', 'Gallery'], ['mosaic', 'Mosaic'], ['spotlight', 'Spotlight'], ['stack', 'Stack'], ['keys', 'Keys'], ['home', 'Pad grid']]
const ASPECTS: [StageAspect, string, string][] = [['9:16', '9:16', 'Reels, TikTok, Shorts'], ['16:9', '16:9', 'YouTube'], ['1:1', '1:1', 'Feed']]

/** A small drawing of each layout, so the choice reads at a glance. */
function LayoutIcon({ mode }: { mode: LayoutMode }) {
  const r = (x: number, y: number, w: number, h: number, k: number) => <rect key={k} x={x} y={y} width={w} height={h} rx={1.2} />
  const shapes: Record<LayoutMode, [number, number, number, number][]> = {
    gallery: [[1, 1, 10, 6.5], [13, 1, 10, 6.5], [1, 9.5, 10, 6.5], [13, 9.5, 10, 6.5]],
    mosaic: [[1, 1, 13, 15], [16, 1, 7, 7], [16, 9.5, 7, 6.5]],
    spotlight: [[1, 1, 22, 11], [1, 13.5, 6.5, 2.5], [8.75, 13.5, 6.5, 2.5], [16.5, 13.5, 6.5, 2.5]],
    stack: [[1, 1, 22, 4.5], [1, 6.5, 22, 4.5], [1, 12, 22, 4]],
    keys: [[1, 4, 4, 9], [6, 4, 4, 9], [11, 4, 4, 9], [16, 4, 4, 9], [21, 4, 2, 9]],
    home: [[1, 1, 5, 3.4], [7, 1, 5, 3.4], [13, 1, 5, 3.4], [19, 1, 4, 3.4], [1, 5.2, 5, 3.4], [7, 5.2, 5, 3.4], [13, 5.2, 5, 3.4], [19, 5.2, 4, 3.4], [1, 9.4, 5, 3.4], [7, 9.4, 5, 3.4], [13, 9.4, 5, 3.4], [19, 9.4, 4, 3.4], [1, 13.6, 5, 2.4], [7, 13.6, 5, 2.4], [13, 13.6, 5, 2.4], [19, 13.6, 4, 2.4]],
  }
  return <svg viewBox="0 0 24 17" aria-hidden="true">{shapes[mode].map(([x, y, w, h], k) => r(x, y, w, h, k))}</svg>
}

/** The take's notes over time, and where its sections change: a read-only timeline for now. */
function Timeline({ take }: { take: Take }) {
  const ons = take.events.filter((e) => e.ev.type === 'on')
  const notes = ons.map((e) => (e.ev as { note: number }).note)
  const lo = Math.min(...notes), hi = Math.max(...notes)
  const cues = take.events.filter((e) => e.ev.type === 'layout')
  const d = Math.max(0.1, take.duration)
  return (
    <div className="timeline">
      <span className="sr">{`${take.name}: ${ons.length} notes over ${take.duration.toFixed(1)} s`}</span>
      {ons.slice(0, 600).map((e, i) => <i key={i} style={{ left: `${(e.t / d) * 100}%`, bottom: `${hi > lo ? (((e.ev as { note: number }).note - lo) / (hi - lo)) * 78 + 6 : 40}%` }} />)}
      {cues.map((e, i) => <b key={`c${i}`} style={{ left: `${(e.t / d) * 100}%` }}>{(e.ev as { section?: string }).section}</b>)}
      <span className="tl-end">{take.duration.toFixed(1)} s</span>
    </div>
  )
}

export function PostMode({ onExport }: { onExport: (song: boolean) => void }) {
  const takes = useStore(app.store, (s) => s.takes)
  const take = useStore(app.store, (s) => s.take)
  const playing = useStore(app.store, (s) => s.playing)
  const recording = useStore(app.store, (s) => s.recording)
  const aspect = useStore(app.store, (s) => s.aspect)
  const kind = useStore(app.store, (s) => s.kind)
  const layout = useStore(app.store, (s) => s.layouts[s.kind])
  const trackLayout = useStore(app.store, (s) => s.trackLayout)
  const songLen = useStore(app.store, (s) => s.tracks.reduce((m, t) => t.clips.reduce((n, c) => Math.max(n, c.start + c.len), m), 0))
  const look = useStore(app.store, (s) => s.look)
  const safe = useStore(ui, (u) => u.safe)
  const lookId = LOOKS.find((l) => JSON.stringify(l.look) === JSON.stringify(look))?.id
  return (
    <div className="mode-body post">
      <div className="takes-col">
        <ul className="takes-row" aria-label="Takes">
          {takes.map((t, i) => (
            <li key={t.id} className={`takecard ${t.id === take?.id ? 'sel' : ''}`}>
              <button type="button" className="tpick" aria-pressed={t.id === take?.id} onClick={() => t.id && app.selectTake(t.id)}>
                <b>{t.name.replace(/ \d{1,2}:\d{2}:\d{2}.*$/, '')} {i + 1}</b>
                <span>{t.duration.toFixed(1)} s, {t.events.filter((e) => e.ev.type === 'on').length} notes</span>
              </button>
              <button type="button" className="x" aria-label={`Delete ${t.name}`} onClick={() => t.id && app.deleteTake(t.id)}><Close size={12} /></button>
            </li>
          ))}
        </ul>
        {!takes.length && <p className="muted">No takes yet. Press <b>Rec</b> (Enter) and play, or play first and press <b>Capture</b> (Shift+Enter) to keep what you just played.</p>}
        {take && (
          <>
            <Timeline take={take} />
            <div className="mrow">
              <button type="button" className="btn sm" disabled={recording} onClick={() => (playing ? app.stopTake() : app.playTake())}>{playing ? <><Stop size={12} />Stop</> : <><Play size={12} />Play the take</>}</button>
              <button type="button" className="btn sm" onClick={() => app.downloadMidi()} title="The take's notes as a MIDI file, for a DAW">Save .mid</button>
              <span className="hint">The take is notes, not pixels: change the shape, layout and look, and it renders again.</span>
            </div>
          </>
        )}
      </div>
      <div className="post-col">
        <fieldset className="aspects"><legend className="lab">Shape</legend>
          {ASPECTS.map(([a, l, t]) => <button key={a} type="button" aria-pressed={aspect === a} onClick={() => app.set('aspect', a)} title={t}><span className={`frame f${a.replace(':', '')}`} />{l}</button>)}
          <button type="button" className="toggle" aria-pressed={safe} onClick={() => ui.set({ safe: !safe })} title="Show where the apps put their buttons and captions">Safe zones</button>
        </fieldset>
        <fieldset className="layouts"><legend className="lab">Tracks</legend>
          {LAYOUTS.filter(([m]) => m === 'gallery' || m === 'mosaic' || m === 'spotlight' || m === 'stack').map(([m, l]) => <button key={m} type="button" aria-pressed={trackLayout === m} onClick={() => { app.set('trackLayout', m); app.stage?.layout.reset() }} title={`The tracks' tiles: ${l}`}><LayoutIcon mode={m} /><span>{l}</span></button>)}
        </fieldset>
        <fieldset className="layouts"><legend className="lab">Notes</legend>
          {LAYOUTS.filter(([m]) => m !== 'home' || kind === 'pads').map(([m, l]) => <button key={m} type="button" aria-pressed={layout === m} onClick={() => app.setLayout(m)} title={l}><LayoutIcon mode={m} /><span>{l}</span></button>)}
        </fieldset>
        <fieldset className="looks"><legend className="lab">Look</legend>
          {LOOKS.map((l) => <button key={l.id} type="button" aria-pressed={lookId === l.id} onClick={() => app.set('look', l.look)}>{l.name}</button>)}
        </fieldset>
        <div className="exports">
          <button type="button" className="btn primary export" disabled={!songLen || recording} onClick={() => onExport(true)} title={songLen ? 'The timeline as an MP4' : 'Put a scene on the timeline first'}>Export the song</button>
          <button type="button" className="btn export" disabled={!take || recording} onClick={() => onExport(false)}>Export the take</button>
        </div>
      </div>
    </div>
  )
}
