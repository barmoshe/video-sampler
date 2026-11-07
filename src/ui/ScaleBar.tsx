import { app } from '../engine/app'
import { SCALES, type ChordMode, type ScaleName } from '../engine/scale'
import { useStore } from '../engine/store'

const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const CHORDS: [ChordMode, string][] = [['off', 'Single notes'], ['triad', 'Triads'], ['seventh', 'Sevenths'], ['power', 'Power (1 5 8)'], ['octave', 'Octaves']]

/** Key, scale lock and chord mode for the computer keyboard and MIDI (the inspector's Play row). */
export function ScaleBar() {
  const s = useStore(app.store, (x) => x.scale)
  const kind = useStore(app.store, (x) => x.kind)
  if (kind === 'pads') return null
  return (
    <div className="scalebar">
      <button type="button" className="btn sm" aria-pressed={s.lock} onClick={() => app.setScale({ lock: !s.lock })} title={s.lock ? 'Every key plays in key: the home row plays the scale from A, the row above an octave up' : 'Lock the keys to a scale: nothing sounds out of key'}>Scale</button>
      <select aria-label="Key" value={s.tonic} onChange={(e) => app.setScale({ tonic: Number(e.target.value) })}>
        {TONICS.map((t, i) => <option key={t} value={i}>{t}</option>)}
      </select>
      <select aria-label="Scale" value={s.scale} onChange={(e) => app.setScale({ scale: e.target.value as ScaleName })}>
        {(Object.keys(SCALES) as ScaleName[]).map((n) => <option key={n} value={n}>{n[0].toUpperCase() + n.slice(1)}</option>)}
      </select>
      <select aria-label="Chord" value={s.chord} onChange={(e) => app.setScale({ chord: e.target.value as ChordMode })}>
        {CHORDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}
