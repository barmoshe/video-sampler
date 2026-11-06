import { app } from '../engine/app'
import { useStore } from '../engine/store'
import { Slider } from './controls'
import { Dialog } from './Dialog'
import { pct } from './format'

const BEATS: [number, string][] = [[0.25, '1/16'], [0.5, '1/8'], [0.75, '1/8 dotted'], [1, '1/4'], [1.5, '1/4 dotted'], [2, '1/2']]
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`)

/** The effects bus: the delay and reverb returns every instrument sends to, and the glue on the mix. */
export function FxDialog({ onClose }: { onClose: () => void }) {
  const fx = useStore(app.store, (s) => s.fx)
  const bpm = useStore(app.store, (s) => s.transport.bpm)
  return (
    <Dialog title="Effects" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Done</button>}>
      <p className="muted" style={{ margin: 0 }}>Each instrument has Delay and Reverb sends. The picture follows: a delay repeats the tile at its own time, fading as the echoes do; a reverb leaves a glow that lasts as long as the tail.</p>
      <fieldset className="field"><legend className="lab">Delay (ping-pong, {bpm} BPM)</legend>
        <select aria-label="Delay time" value={fx.delay.beats} onChange={(e) => app.setFx({ delay: { ...fx.delay, beats: Number(e.target.value) } })}>
          {BEATS.map(([b, l]) => <option key={b} value={b}>{l}</option>)}
        </select>
        <div className="grid2" style={{ marginTop: 8 }}>
          <Slider label="Feedback" value={fx.delay.feedback} min={0} max={0.9} step={0.01} format={pct} onChange={(feedback) => app.setFx({ delay: { ...fx.delay, feedback } })} />
          <Slider label="Tone" value={fx.delay.tone} min={500} max={12000} step={100} format={hz} onChange={(tone) => app.setFx({ delay: { ...fx.delay, tone } })} />
          <Slider label="Return" value={fx.delay.level} min={0} max={1} step={0.01} format={pct} onChange={(level) => app.setFx({ delay: { ...fx.delay, level } })} />
        </div>
      </fieldset>
      <fieldset className="field"><legend className="lab">Reverb</legend>
        <div className="grid2">
          <Slider label="Decay" value={fx.reverb.decay} min={0.3} max={6} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(decay) => app.setFx({ reverb: { ...fx.reverb, decay } })} />
          <Slider label="Tone" value={fx.reverb.tone} min={1000} max={16000} step={100} format={hz} onChange={(tone) => app.setFx({ reverb: { ...fx.reverb, tone } })} />
          <Slider label="Return" value={fx.reverb.level} min={0} max={1} step={0.01} format={pct} onChange={(level) => app.setFx({ reverb: { ...fx.reverb, level } })} />
        </div>
      </fieldset>
      <Slider label="Glue (bus compression)" value={fx.glue} min={0} max={1} step={0.01} format={pct} onChange={(glue) => app.setFx({ glue })} />
    </Dialog>
  )
}
