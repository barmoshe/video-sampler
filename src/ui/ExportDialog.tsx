import { useState } from 'react'
import { app } from '../engine/app'
import { exportSize, type ExportOptions } from '../engine/export'
import { useStore } from '../engine/store'
import type { LayoutMode, StageAspect } from '../engine/types'
import { Seg } from './controls'
import { Dialog } from './Dialog'

/** The take, or the whole song (the timeline), as an MP4. */
export function ExportDialog({ onClose, song = false }: { onClose: () => void; song?: boolean }) {
  const take = useStore(app.store, (s) => s.take)
  const kind = useStore(app.store, (s) => s.kind)
  const aspect0 = useStore(app.store, (s) => s.aspect)
  const layout0 = useStore(app.store, (s) => (song ? s.trackLayout : s.layouts[s.kind]))
  const [o, setO] = useState<ExportOptions>({ aspect: aspect0, layout: layout0, height: 1080, fps: 30 })
  const [w, h] = exportSize(o.aspect, o.height)
  const layouts: [LayoutMode, string][] = song ? [['gallery', 'Gallery'], ['mosaic', 'Mosaic'], ['spotlight', 'Spotlight'], ['stack', 'Stack']] : [['gallery', 'Gallery'], ['keys', 'Keys'], ['stack', 'Stack'], ['mosaic', 'Mosaic'], ['spotlight', 'Spotlight'], ...(kind === 'pads' ? [['home', 'Home grid'] as [LayoutMode, string]] : [])]
  return (
    <Dialog
      title={song ? 'Export the song as MP4' : 'Export the take as MP4'}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={!take && !song} onClick={() => { onClose(); void (song ? app.exportSong(o) : app.export(o)) }}>Export {w}×{h}</button>
      </>}
    >
      <p className="muted" style={{ margin: 0 }}>
        {song ? 'The timeline, every track through its own instrument, each track in its own tile; picture cues change the layout and look as they come.' : take ? `${take.name}, ${take.duration.toFixed(1)} s, ${take.events.filter((e) => e.ev.type === 'on').length} notes.` : 'Record a take first.'} It is notes, not pixels, so it renders cleanly in any shape and layout, faster than real time on most laptops.
      </p>
      <Seg<StageAspect> label="Shape" value={o.aspect} options={[['16:9', '16:9 YouTube'], ['9:16', '9:16 Reels, TikTok'], ['1:1', '1:1']]} onChange={(aspect) => setO({ ...o, aspect })} />
      <Seg<LayoutMode> label="Layout" value={o.layout} options={layouts} onChange={(layout) => setO({ ...o, layout })} />
      <div className="grid2">
        <Seg<'720' | '1080'> label="Size" value={String(o.height) as '720' | '1080'} options={[['1080', '1080p'], ['720', '720p']]} onChange={(v) => setO({ ...o, height: Number(v) as 720 | 1080 })} />
        <Seg<'30' | '60'> label="Frame rate" value={String(o.fps) as '30' | '60'} options={[['30', '30 fps'], ['60', '60 fps']]} onChange={(v) => setO({ ...o, fps: Number(v) as 30 | 60 })} />
      </div>
      <p className="muted" style={{ margin: 0 }}>H.264 + AAC, BT.709, loudness normalised to −14 LUFS: ready for Instagram, TikTok and YouTube.</p>
    </Dialog>
  )
}
