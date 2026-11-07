import { app } from '../engine/app'
import type { Track } from '../engine/song'
import { useStore } from '../engine/store'

/** The song's tracks as they play now: the selected one's instrument lives in the store while selected. */
export function useSongTracks(): Track[] {
  const tracks = useStore(app.store, (s) => s.tracks)
  const sel = useStore(app.store, (s) => s.sel)
  const kind = useStore(app.store, (s) => s.kind), clip = useStore(app.store, (s) => s.clip), pads = useStore(app.store, (s) => s.pads), layers = useStore(app.store, (s) => s.layers)
  return tracks.map((t) => (t.id === sel ? { ...t, inst: { kind, clip, pads, layers } } : t))
}
