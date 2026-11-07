import { useEffect, useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import { AboutDialog } from './AboutDialog'
import { CameraDialog } from './CameraDialog'
import { Deck } from './Deck'
import { ExportDialog } from './ExportDialog'
import { LibraryDialog } from './LibraryDialog'
import { SettingsDialog } from './SettingsDialog'
import { SongView } from './SongView'
import { StagePane } from './StagePane'
import { TopBar } from './TopBar'
import { ui } from './ui'

/**
 * A video DAW (ADR 0772, 0773): a slim bar with the song's transport; the stage beside the song (the
 * board or the timeline, Tab); and a deck with four modes (PLAY, SHAPE, MIX, POST) and eight knobs that
 * follow whatever was touched last.
 */
export function App() {
  const [dialog, setDialog] = useState<'export' | 'song' | 'camera' | 'settings' | 'library' | 'about' | null>(null)
  const mode = useStore(ui, (u) => u.mode)
  const kind = useStore(app.store, (s) => s.kind)
  const big = useStore(ui, (u) => u.big)
  useEffect(() => app.attachKeyboard(), [])
  return (
    <div className={`app mode-${mode} kind-${kind}`}>
      <TopBar onSettings={() => setDialog('settings')} onLibrary={() => setDialog('library')} onAbout={() => setDialog('about')} />
      <div className={`work ${big ? 'big' : ''}`}>
        <StagePane onCamera={() => setDialog('camera')} onLibrary={() => setDialog('library')} />
        {!big && <SongView />}
      </div>
      <Deck onLibrary={() => setDialog('library')} onCamera={() => setDialog('camera')} onExport={(song) => setDialog(song ? 'song' : 'export')} />
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'song' && <ExportDialog song onClose={() => setDialog(null)} />}
      {dialog === 'camera' && <CameraDialog onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'library' && <LibraryDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
    </div>
  )
}
