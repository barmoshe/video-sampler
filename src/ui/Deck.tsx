import { useEffect } from 'react'
import { useStore } from '../engine/store'
import { DeckKnobs } from './Knobs'
import { MixMode } from './MixMode'
import { PianoRoll } from './PianoRoll'
import { PlayMode } from './PlayMode'
import { PostMode } from './PostMode'
import { ShapeMode } from './ShapeMode'
import { MODES, setMode, ui } from './ui'

/**
 * The deck under the stage (ADR 0772): four mode keys, what the mode plays or edits, and eight knobs
 * that follow the selection. Option+1-4 switch modes from the keyboard.
 */
export function Deck({ onLibrary, onCamera, onExport }: { onLibrary: () => void; onCamera: () => void; onExport: (song: boolean) => void }) {
  const mode = useStore(ui, (u) => u.mode)
  const pick = useStore(ui, (u) => u.pick)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return
      const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code)
      if (i >= 0) { e.preventDefault(); setMode(MODES[i][0]) }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  return (
    <section className="deck" aria-label="Deck">
      <nav className="modes" aria-label="Modes">
        {MODES.map(([m, l, sub], i) => (
          <button key={m} type="button" className={`modekey m-${m}`} aria-pressed={mode === m} onClick={() => setMode(m)} title={`${l}: ${sub} (Option+${i + 1})`}>
            <i className="led" /><b>{l}</b><small>{sub}</small>
          </button>
        ))}
      </nav>
      <div className="deck-body">
        {mode === 'play' && <PlayMode onLibrary={onLibrary} onCamera={onCamera} />}
        {mode === 'shape' && (pick ? <div className="mode-body shape"><PianoRoll pick={pick} /></div> : <ShapeMode />)}
        {mode === 'mix' && <MixMode />}
        {mode === 'post' && <PostMode onExport={onExport} />}
      </div>
      <DeckKnobs />
    </section>
  )
}
