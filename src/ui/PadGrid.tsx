import { app, levelVelocity } from '../engine/app'
import { PAD_BASE } from '../engine/instruments'
import { PAD_LABEL } from '../engine/input'
import { useStore } from '../engine/store'
import { noteName } from '../engine/voice-math'
import { rgb } from './format'

/** The block is laid out like the keys: the bottom row is the bank's first four pads (Z X C V). */
const ORDER = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3]

/**
 * The 4×4 pads with their clips' pictures: press to play, drop videos to load (several fill upward),
 * drag onto another pad to swap, Alt-drag to layer. `play={false}` only selects (SHAPE mode).
 */
export function PadGrid({ play = true }: { play?: boolean }) {
  const pads = useStore(app.store, (s) => s.pads)
  const clips = useStore(app.store, (s) => s.clips)
  const active = useStore(app.store, (s) => s.active)
  const velocity = useStore(app.store, (s) => s.velocity)
  const levels = useStore(app.store, (s) => s.padPlay.levels) && play
  const base = PAD_BASE + pads.bank * 16
  return (
    <div className="padgrid">
      {ORDER.map((i) => {
        const note = base + i
        const chs = pads.chains.filter((c) => c.note === note && c.clipId)
        const shown = levels ? pads.chains.find((c) => c.note === pads.selected) : chs[0]
        const clip = clips.find((c) => c.id === shown?.clipId)
        const playable = play && (levels ? !!clip : chs.length > 0)
        const on = !levels && active.includes(note)
        return (
          <button
            key={note}
            type="button"
            className={`pad ${on ? 'on' : ''} ${clip ? 'full' : ''}`}
            aria-pressed={!levels && pads.selected === note}
            aria-label={levels ? `Velocity ${levelVelocity(i)}` : `Pad ${noteName(note)}${clip ? `, ${clip.name}${chs.length > 1 ? `, ${chs.length} layers` : ''}` : ', empty'}`}
            draggable={!levels && chs.length > 0}
            onDragStart={(e) => e.dataTransfer.setData('text/x-pad', String(note))}
            onPointerDown={() => { if (!levels) app.setPads({ selected: note }); if (playable) app.handlers.noteOn(note, velocity, performance.now(), 'keys') }}
            onPointerUp={() => playable && app.handlers.noteOff(note, performance.now())}
            onPointerLeave={(e) => playable && e.buttons && app.handlers.noteOff(note, performance.now())}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation()
              const from = e.dataTransfer.getData('text/x-pad')
              if (from) { if (e.altKey) app.layerPad(Number(from), note); else app.swapPads(Number(from), note); return }
              if (e.dataTransfer.files.length) void app.importToPads([...e.dataTransfer.files], note)
            }}
          >
            {clip && <span className="fill" style={{ background: `${rgb(clip.poster)} url(${clip.thumb}) center / cover`, opacity: levels ? 0.25 + (0.75 * i) / 15 : undefined }} />}
            <span className="pk">{PAD_LABEL[i]}</span>
            <span className="pn">{levels ? `vel ${levelVelocity(i)}` : clip ? `${clip.name}${chs.length > 1 ? ` ×${chs.length}` : ''}` : noteName(note)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Banks A-H: each holds sixteen more pads. */
export function Banks() {
  const bank = useStore(app.store, (s) => s.pads.bank)
  const chains = useStore(app.store, (s) => s.pads.chains)
  return (
    <fieldset className="banks"><legend className="sr">Bank</legend>
      {Array.from({ length: 8 }, (_, b) => {
        const used = chains.some((c) => c.clipId && c.note >= PAD_BASE + b * 16 && c.note < PAD_BASE + b * 16 + 16)
        return (
          <button key={b} type="button" aria-pressed={bank === b} className={used ? 'used' : ''} title={`Bank ${'ABCDEFGH'[b]}: pads ${noteName(PAD_BASE + b * 16)} to ${noteName(PAD_BASE + b * 16 + 15)}`} onClick={() => app.setPads({ bank: b, selected: PAD_BASE + b * 16 })}>{'ABCDEFGH'[b]}</button>
        )
      })}
    </fieldset>
  )
}
