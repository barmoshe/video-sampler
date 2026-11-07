import { useEffect, useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import { AboutDialog } from './AboutDialog'
import { CameraDialog } from './CameraDialog'
import { ExportDialog } from './ExportDialog'
import { Wallpaper } from './glass'
import { Inspector } from './Inspector'
import { LibraryDialog } from './LibraryDialog'
import { LibraryPane } from './LibraryPane'
import { SettingsDialog } from './SettingsDialog'
import { SongView } from './SongView'
import { StagePane } from './StagePane'
import { TakesDialog } from './TakesDialog'
import { TopBar } from './TopBar'
import { trackColor } from './palette'
import { togglePane, ui } from './ui'

type DialogName = 'export' | 'song' | 'camera' | 'settings' | 'library' | 'about' | 'takes'

/**
 * VIDAW's window (ADR 0776): the picture is the desk. The stage in the middle, the biggest thing, never
 * hidden; the library on its left, the inspector (whatever is selected) on its right, the song under it
 * (board or timeline, Tab). No keys on screen: the computer keyboard plays when M is on, as in Live.
 * Option+1, 2 and 3 hide the library, the inspector and the song; Option+4 leaves the stage alone.
 */
export function App() {
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const kind = useStore(app.store, (s) => s.kind)
  const panes = useStore(ui, (u) => u.panes)
  const big = useStore(ui, (u) => u.big)
  const hue = useStore(app.store, (s) => s.tracks.find((t) => t.id === s.sel)?.hue ?? 22)
  const color = trackColor(hue)
  useEffect(() => app.attachKeyboard(), [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return
      const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code)
      if (i < 0) return
      e.preventDefault()
      if (i === 3) ui.set({ big: !ui.get().big }); else togglePane((['lib', 'insp', 'song'] as const)[i])
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  const lib = panes.lib && !big, insp = panes.insp && !big, song = panes.song && !big
  return (
    <>
      <Wallpaper />
      <div className={`app kind-${kind} ${lib ? 'with-lib' : ''} ${insp ? 'with-insp' : ''} ${song ? 'with-song' : ''}`} style={{ ['--track' as string]: color }}>
        <TopBar onSettings={() => setDialog('settings')} onAbout={() => setDialog('about')} onTakes={() => setDialog('takes')} onExport={() => setDialog('song')} />
        {lib && <LibraryPane onCamera={() => setDialog('camera')} onLibrary={() => setDialog('library')} />}
        <StagePane onCamera={() => setDialog('camera')} onLibrary={() => setDialog('library')} />
        {insp && <Inspector onCamera={() => setDialog('camera')} />}
        {song && <SongView />}
        {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
        {dialog === 'song' && <ExportDialog song onClose={() => setDialog(null)} />}
        {dialog === 'camera' && <CameraDialog onClose={() => setDialog(null)} />}
        {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
        {dialog === 'library' && <LibraryDialog onClose={() => setDialog(null)} />}
        {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
        {dialog === 'takes' && <TakesDialog onClose={() => setDialog(null)} onExport={() => setDialog('export')} />}
      </div>
    </>
  )
}
