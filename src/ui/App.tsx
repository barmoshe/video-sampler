import { useEffect, useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import { AboutDialog } from './AboutDialog'
import { CameraDialog } from './CameraDialog'
import { Deck } from './Deck'
import { ExportDialog } from './ExportDialog'
import { LibraryDialog } from './LibraryDialog'
import { SettingsDialog } from './SettingsDialog'
import { StagePane } from './StagePane'
import { TopBar } from './TopBar'
import { ui } from './ui'

/**
 * One instrument (ADR 0772): a slim bar, the stage as the hero, and a deck with four modes (PLAY,
 * SHAPE, LOOP, POST) and eight knobs that follow whatever was touched last.
 */
export function App() {
  const [dialog, setDialog] = useState<'export' | 'camera' | 'settings' | 'library' | 'about' | null>(null)
  const mode = useStore(ui, (u) => u.mode)
  const kind = useStore(app.store, (s) => s.kind)
  useEffect(() => app.attachKeyboard(), [])
  return (
    <div className={`app mode-${mode} kind-${kind}`}>
      <TopBar onSettings={() => setDialog('settings')} onLibrary={() => setDialog('library')} onAbout={() => setDialog('about')} />
      <StagePane onCamera={() => setDialog('camera')} onLibrary={() => setDialog('library')} />
      <Deck onLibrary={() => setDialog('library')} onCamera={() => setDialog('camera')} onExport={() => setDialog('export')} />
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'camera' && <CameraDialog onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'library' && <LibraryDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
    </div>
  )
}
