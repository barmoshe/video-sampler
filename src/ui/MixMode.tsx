import { app } from '../engine/app'
import { trackColor } from './palette'
import { audible, type Track } from '../engine/song'
import { useStore } from '../engine/store'
import { rgb, panText } from './format'
import { useSongTracks } from './hooks'
import { trackThumb } from './thumbs'

/**
 * The mixer is the picture (ADR 0773): every track's strip sits under its own tile. The fader and pan
 * change the sound and the tile together (a quieter track is a dimmer tile).
 */
function Strip({ t, sel, all }: { t: Track; sel: boolean; all: Track[] }) {
  const clips = useStore(app.store, (s) => s.clips)
  const thumb = t.kind === 'picture' ? undefined : trackThumb(t, clips)
  const on = audible(t, all)
  const gain = Math.pow(10, t.mix.volume / 20)
  return (
    <div className={`strip2 ${sel ? 'sel' : ''} ${on ? '' : 'off'}`} style={{ ['--h' as string]: trackColor(t) }}>
      <button type="button" className="mtile" onClick={() => (t.kind === 'instrument' || t.kind === 'video') && app.selectTrack(t.id)} aria-label={`Select ${t.name}`}
        style={{ background: thumb ? `${rgb(thumb.poster)} url(${thumb.thumb}) center / cover` : undefined, opacity: on ? 0.35 + 0.65 * Math.min(1, gain) : 0.25 }}>
        {!thumb && <span>{t.kind}</span>}
      </button>
      <span className="mname" title={t.name}>{t.name}</span>
      <div className="fader">
        <input type="range" min={-48} max={6} step={0.5} value={t.mix.volume} aria-label={`${t.name} volume`} aria-valuetext={`${t.mix.volume} dB`}
          onChange={(e) => app.setMix(t.id, { volume: Number(e.target.value) })} onDoubleClick={() => app.setMix(t.id, { volume: 0 })} />
        <span className="db">{t.mix.volume > 0 ? '+' : ''}{t.mix.volume.toFixed(1)}</span>
      </div>
      <input className="pan" type="range" min={-1} max={1} step={0.05} value={t.mix.pan} aria-label={`${t.name} pan`} aria-valuetext={panText(t.mix.pan)}
        onChange={(e) => app.setMix(t.id, { pan: Number(e.target.value) })} onDoubleClick={() => app.setMix(t.id, { pan: 0 })} title={`Pan ${panText(t.mix.pan)} (double-click: centre)`} />
      <div className="msrow">
        <button type="button" className="ms" aria-pressed={t.mix.mute} onClick={() => app.setMix(t.id, { mute: !t.mix.mute })}>M</button>
        <button type="button" className="ms solo" aria-pressed={t.mix.solo} onClick={() => app.setMix(t.id, { solo: !t.mix.solo })}>S</button>
      </div>
    </div>
  )
}

export function MixMode() {
  const tracks = useSongTracks()
  const sel = useStore(app.store, (s) => s.sel)
  return (
    <div className="mode-body mix">
      <fieldset className="strips"><legend className="sr">Mixer</legend>
        {tracks.map((t) => <Strip key={t.id} t={t} sel={t.id === sel} all={tracks} />)}
      </fieldset>
    </div>
  )
}
