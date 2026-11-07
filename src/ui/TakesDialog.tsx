import { app } from '../engine/app'
import { useStore } from '../engine/store'
import type { Take } from '../engine/take'
import { Dialog } from './Dialog'
import { Close, Play, Stop } from './icons'

/** The take's notes over time, and where its sections change. */
function TakeLine({ take }: { take: Take }) {
  const ons = take.events.filter((e) => e.ev.type === 'on')
  const notes = ons.map((e) => (e.ev as { note: number }).note)
  const lo = Math.min(...notes), hi = Math.max(...notes)
  const d = Math.max(0.1, take.duration)
  return (
    <div className="timeline">
      <span className="sr">{`${take.name}: ${ons.length} notes over ${take.duration.toFixed(1)} s`}</span>
      {ons.slice(0, 600).map((e, i) => <i key={i} style={{ left: `${(e.t / d) * 100}%`, bottom: `${hi > lo ? (((e.ev as { note: number }).note - lo) / (hi - lo)) * 78 + 6 : 40}%` }} />)}
      <span className="tl-end">{take.duration.toFixed(1)} s</span>
    </div>
  )
}

/**
 * Takes (ADR 0776): performances kept apart from the song, by Take or by Capture. Each is notes, not
 * pixels, so it renders again in any shape, layout and look.
 */
export function TakesDialog({ onClose, onExport }: { onClose: () => void; onExport: () => void }) {
  const takes = useStore(app.store, (s) => s.takes)
  const take = useStore(app.store, (s) => s.take)
  const playing = useStore(app.store, (s) => s.playing)
  const recording = useStore(app.store, (s) => s.recording)
  return (
    <Dialog title="Takes" onClose={onClose} footer={<>
      <button type="button" className="btn rec" aria-pressed={recording} onClick={() => app.toggleRecord()} style={{ marginRight: 'auto' }}><span className="dot" />{recording ? 'Stop the take' : 'Record a take'}</button>
      <button type="button" className="btn" disabled={!take} onClick={() => app.downloadMidi()} title="The take's notes as a MIDI file, for a DAW">Save .mid</button>
      <button type="button" className="btn primary" disabled={!take || recording} onClick={onExport}>Export the take</button>
    </>}>
      {!takes.length && <p className="muted">No takes yet. Record a take below and play, or play first and press <b>Capture</b> (Shift+Enter) to keep what you just played.</p>}
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
      {take && (
        <>
          <TakeLine take={take} />
          <div className="row">
            <button type="button" className="btn sm" disabled={recording} onClick={() => (playing ? app.stopTake() : app.playTake())}>{playing ? <><Stop size={12} />Stop</> : <><Play size={12} />Play the take</>}</button>
            <span className="hint">The take is notes, not pixels: change the shape, layout and look, and it renders again.</span>
          </div>
        </>
      )}
    </Dialog>
  )
}
