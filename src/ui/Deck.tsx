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
  const sub = MODES.find((m) => m[0] === mode)?.[2]
  return (
    <section className="deck" aria-label="Deck">
      <div className="deck-main">
        <header className="deck-head">
          <fieldset className="segctl" aria-label="Modes"><legend className="sr">Modes</legend>
            {MODES.map(([m, l, s2], i) => (
              <button key={m} type="button" data-mode={m} aria-pressed={mode === m} onClick={() => setMode(m)} title={`${l}: ${s2} (Option+${i + 1})`}>{l}</button>
            ))}
          </fieldset>
          <span className="deck-sub">{sub}</span>
        </header>
        <div className="deck-body">
          {mode === 'play' && <PlayMode onLibrary={onLibrary} onCamera={onCamera} />}
          {mode === 'shape' && (pick ? <div className="mode-body shape"><PianoRoll pick={pick} /></div> : <ShapeMode />)}
          {mode === 'mix' && <MixMode />}
          {mode === 'post' && <PostMode onExport={onExport} />}
        </div>
      </div>
      <DeckKnobs />
    </section>
  )
}
