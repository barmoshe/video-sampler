import type { SongClip, Track } from '../engine/song'
import type { Clip } from '../engine/types'

/** The picture a track shows in its header and its clips: its instrument's clip, or a clip's own video. */
export function trackThumb(t: Track, clips: Clip[], c?: SongClip): Clip | undefined {
  const id = c?.media?.clipId ?? (t.inst.kind === 'pads' ? t.inst.pads.chains.find((x) => x.clipId)?.clipId : t.inst.kind === 'layers' ? t.inst.layers.chains.find((x) => x.clipId)?.clipId : t.inst.clip.clipId)
  return clips.find((x) => x.id === id)
}

