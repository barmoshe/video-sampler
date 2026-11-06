import { app } from '../engine/app'
import { useStore } from '../engine/store'
import { Seg, Slider } from './controls'
import { Dialog } from './Dialog'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore(app.store, (x) => x)
  const tight = Math.ceil(((app.ctx.outputLatency || 0) + app.ctx.baseLatency) * 1000 + 5)
  return (
    <Dialog title="Settings" onClose={onClose} footer={<button type="button" className="btn" onClick={() => { app.panic(); onClose() }}>All notes off</button>}>
      <Slider label="Picture offset" value={s.pictureOffsetMs} min={0} max={150} format={(v) => `${v} ms`} onChange={(v) => app.set('pictureOffsetMs', v)} />
      <p className="muted" style={{ margin: 0 }}>
        Screens show a frame later than the browser says. On a 2019 MacBook Pro in Chrome it measured 58 ms in a window and 78 ms full screen
        (filmed at 240 fps). Raise it if the picture trails the sound.
      </p>
      <Seg label="Live notes" value={s.latencyMode} options={[['tight', `Tight sound (${tight} ms)`], ['sync', `In sync (${tight + s.pictureOffsetMs} ms)`]]} onChange={(v) => app.set('latencyMode', v)} />
      <p className="muted" style={{ margin: 0 }}>A key cannot be drawn before you press it. Tight sound plays at once and the picture follows; In sync waits for the picture. Takes and exports are always exact.</p>
      <Seg label="Tiles" value={s.fit ? 'fit' : 'fill'} options={[['fill', 'Fill (crop to the tile)'], ['fit', 'Fit (whole picture)']]} onChange={(v) => app.set('fit', v === 'fit')} />
      <Slider label="Pitch bend range" value={s.bendRange} min={1} max={24} format={(v) => `±${v} st`} onChange={(v) => app.set('bendRange', v)} />
    </Dialog>
  )
}
