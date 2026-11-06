import { useEffect, useRef, useState } from 'react'
import { app } from '../engine/app'
import { homeKey, SLICE_BASE } from '../engine/instruments'
import { KEY_LABEL, NOTE_KEYS } from '../engine/input'
import { HOME_ROW, inScale, keyNote, SCALES, UPPER_ROW, type ChordMode, type ScaleName } from '../engine/scale'
import { useStore } from '../engine/store'
import { noteName } from '../engine/voice-math'

const BLACK = new Set([1, 3, 6, 8, 10])

/** Three octaves around the computer-keyboard octave; click or touch to play, letters show the keys. */
export function Keyboard() {
  const el = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  const octave = useStore(app.store, (s) => s.octave)
  const active = useStore(app.store, (s) => s.active)
  const kind = useStore(app.store, (s) => s.kind)
  const clipP = useStore(app.store, (s) => s.clip)
  const clips = useStore(app.store, (s) => s.clips)
  const velocity = useStore(app.store, (s) => s.velocity)
  const scale = useStore(app.store, (s) => s.scale)
  const pointer = useRef(new Map<number, number>())

  useEffect(() => {
    const ro = new ResizeObserver(() => setWidth(el.current?.clientWidth ?? 1000))
    ro.observe(el.current!)
    return () => ro.disconnect()
  }, [])

  const base = 60 + 12 * octave
  const lo = base - 12, hi = base + 23
  const whites = [] as number[]
  for (let n = lo; n <= hi; n++) if (!BLACK.has(n % 12)) whites.push(n)
  const ww = width / whites.length
  const clip = clips.find((c) => c.id === clipP.clipId)
  const root = kind === 'clip' && clip && clipP.mode !== 'slice' ? homeKey(clipP, clip) : null
  const label = (code: string) => KEY_LABEL[code] ?? code.replace('Key', '')
  const qwerty = scale.lock
    ? new Map([...HOME_ROW, ...UPPER_ROW].map((code) => [keyNote(code, base, scale), label(code)] as const).filter((x): x is [number, string] => x[0] !== null))
    : new Map(NOTE_KEYS.map((code, i) => [base + i, label(code)]))
  const sliceMode = kind === 'clip' && clipP.mode === 'slice'

  const down = (e: React.PointerEvent, note: number) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointer.current.set(e.pointerId, note)
    app.handlers.noteOn(note, velocity, performance.now(), 'keys')
  }
  const up = (e: React.PointerEvent) => {
    const n = pointer.current.get(e.pointerId)
    if (n === undefined) return
    pointer.current.delete(e.pointerId)
    app.handlers.noteOff(n, performance.now())
  }

  // positions first: white keys in a row, black keys over the gaps
  const layout = positions(lo, hi, ww)
  return (
    <div className="keyzone">
    <ScaleBar />
    <div className="keys" ref={el}>
      {layout.map(({ n, x, w, black }) => (
        <button
          type="button"
          key={n}
          tabIndex={-1}
          aria-label={`Play ${noteName(n)}`}
          className={`key ${black ? 'b' : 'w'} ${active.includes(n) ? 'on' : ''} ${root === n ? 'root' : ''} ${scale.lock && !sliceMode && !inScale(n, scale) ? 'out' : ''} ${scale.lock && !sliceMode && (n - scale.tonic) % 12 === 0 ? 'tonic' : ''}`}
          style={{ left: x, width: w }}
          onPointerDown={(e) => down(e, n)}
          onPointerUp={up}
          onPointerCancel={up}
        >
          {root === n && <span className="home">home</span>}
          {qwerty.has(n) && <span className="qw">{qwerty.get(n)}</span>}
          <span className="nm">{sliceMode ? (n >= SLICE_BASE ? `S${n - SLICE_BASE + 1}` : '') : noteName(n)}</span>
        </button>
      ))}
    </div>
    </div>
  )
}

const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const CHORDS: [ChordMode, string][] = [['off', 'Single notes'], ['triad', 'Triads'], ['seventh', 'Sevenths'], ['power', 'Power (1 5 8)'], ['octave', 'Octaves']]

/** Key, scale lock and chord mode, above the keys. */
function ScaleBar() {
  const s = useStore(app.store, (x) => x.scale)
  const kind = useStore(app.store, (x) => x.kind)
  if (kind === 'pads') return null
  return (
    <div className="scalebar">
      <label className="check"><input type="checkbox" checked={s.lock} onChange={(e) => app.setScale({ lock: e.target.checked })} />Scale lock</label>
      <select aria-label="Key" value={s.tonic} onChange={(e) => app.setScale({ tonic: Number(e.target.value) })}>
        {TONICS.map((t, i) => <option key={t} value={i}>{t}</option>)}
      </select>
      <select aria-label="Scale" value={s.scale} onChange={(e) => app.setScale({ scale: e.target.value as ScaleName })}>
        {(Object.keys(SCALES) as ScaleName[]).map((n) => <option key={n} value={n}>{n[0].toUpperCase() + n.slice(1)}</option>)}
      </select>
      <select aria-label="Chord" value={s.chord} onChange={(e) => app.setScale({ chord: e.target.value as ChordMode })}>
        {CHORDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <span className="muted">{s.lock ? 'Home row plays the scale from A; the row above, an octave up. Nothing sounds out of key.' : 'Turn on Scale lock and every key is in key.'}</span>
    </div>
  )
}

function positions(lo: number, hi: number, ww: number) {
  const out: { n: number; x: number; w: number; black: boolean }[] = []
  let wi = 0
  for (let n = lo; n <= hi; n++) {
    const black = BLACK.has(n % 12)
    out.push({ n, black, x: black ? wi * ww - ww * 0.32 : wi * ww, w: black ? ww * 0.64 : ww })
    if (!black) wi++
  }
  return out
}
