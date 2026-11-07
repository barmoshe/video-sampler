import { useRef, useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import { Seg, Slider } from './controls'
import { Dialog } from './Dialog'
import { setTheme, setWall, theme, wall, type Theme, type Wall } from './ui'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const openFile = useRef<HTMLInputElement>(null)
  const [look, setLook] = useState<Theme>(theme)
  const [paper, setPaper] = useState<Wall>(wall)
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
      <Seg<Theme> label="Theme" value={look} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'Like this Mac']]} onChange={(t) => { setTheme(t); setLook(t) }} />
      <Seg<Wall> label="Wallpaper" value={paper} options={[['mark', 'The VIDAW tiles'], ['plain', 'Plain']]} onChange={(w) => { setWall(w); setPaper(w) }} />
      <Seg label="Tiles" value={s.fit ? 'fit' : 'fill'} options={[['fill', 'Fill (crop to the tile)'], ['fit', 'Fit (whole picture)']]} onChange={(v) => app.set('fit', v === 'fit')} />
      <Slider label="Pitch bend range" value={s.bendRange} min={1} max={24} format={(v) => `±${v} st`} onChange={(v) => app.set('bendRange', v)} />
      <p className="muted" style={{ margin: 0 }}>Your project saves itself in this browser and comes back when you return. Clearing the browser's data removes it, so save a project file to keep it or move it to another computer.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => void app.saveProjectFile()}>Save project file</button>
        <button type="button" className="btn" onClick={() => openFile.current?.click()}>Open project file</button>
        <button type="button" className="btn" onClick={() => { if (confirm('Start a new, empty project? The saved one is removed from this browser.')) void app.newProject() }}>New project</button>
      </div>
      <input ref={openFile} type="file" accept=".vsamp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { onClose(); void app.openProjectFile(f) } e.target.value = '' }} />
    </Dialog>
  )
}
