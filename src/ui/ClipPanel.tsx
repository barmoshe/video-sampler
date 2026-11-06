import { app } from '../engine/app'
import { clipRoot, sliceTimes, type ClipParams } from '../engine/instruments'
import { useStore } from '../engine/store'
import type { Clip } from '../engine/types'
import { noteName } from '../engine/voice-math'
import { Check, Section, Seg, Slider } from './controls'
import { ms, pct, rgb } from './format'

export function ClipList({ selected, onPick }: { selected: string | null; onPick: (id: string) => void }) {
  const clips = useStore(app.store, (s) => s.clips)
  if (!clips.length) return <p className="muted">No clips yet.</p>
  return (
    <div className="clips">
      {clips.map((c) => (
        <button type="button" key={c.id} className="cliprow" aria-pressed={c.id === selected} onClick={() => onPick(c.id)}>
          <span className="swatch" style={{ background: rgb(c.poster) }} />
          <span>{c.name}</span>
          <span className="muted">{c.duration.toFixed(1)} s</span>
        </button>
      ))}
    </div>
  )
}

function Region({ p, clip }: { p: ClipParams; clip: Clip }) {
  const slices = p.mode === 'slice' ? sliceTimes(p, clip) : []
  return (
    <div className="region" aria-hidden="true">
      <i style={{ left: pct(p.start), width: pct(p.end - p.start), background: '#2b2b30' }} />
      {p.mode === 'classic' && p.loop && <i style={{ left: pct(p.loopStart), width: pct(Math.max(0, p.loopEnd - p.loopStart)), background: 'rgba(111,174,242,.35)', borderLeft: '1px solid #6faef2', borderRight: '1px solid #6faef2' }} />}
      {slices.map((t, i) => <i key={i} style={{ left: pct(t / clip.duration), width: 1, background: '#f2621b' }} />)}
    </div>
  )
}

export function ClipPanel({ onCamera }: { onCamera: () => void }) {
  const p = useStore(app.store, (s) => s.clip)
  const clip = useStore(app.store, (s) => s.clips.find((c) => c.id === s.clip.clipId) ?? null)
  const set = (x: Partial<ClipParams>) => app.setClip(x)
  return (
    <>
      <Section title="Clip" action={<button type="button" className="btn" onClick={onCamera}>Camera</button>}>
        <ClipList selected={p.clipId} onPick={(id) => set({ clipId: id })} />
        {clip && (
          <p className="muted" style={{ margin: '10px 0 0' }}>
            {clip.rootFound
              ? <>Sounds at <b style={{ color: '#f2efe6' }}>{noteName(Math.round(clip.root))}</b>{fmtCents(clip.root)}, so C3 plays a real C.</>
              : 'No clear pitch found: C3 plays it as recorded.'}
            {' '}{count(clip.onsets.length, 'hit')}, {count(clip.cuts.length, 'cut')}.
          </p>
        )}
      </Section>
      {clip && (
        <>
          <Section title="Play">
            <div className="grid2">
              <div style={{ gridColumn: '1 / -1' }}>
                <Seg label="Mode" value={p.mode} options={[['classic', 'Classic'], ['oneshot', 'One-Shot'], ['slice', 'Slice']]} onChange={(mode) => set({ mode })} />
              </div>
              <Slider label="Transpose" value={p.transpose} min={-48} max={48} format={(v) => `${v > 0 ? '+' : ''}${v} st`} onChange={(transpose) => set({ transpose })} />
              <Slider label="Detune" value={p.detune} min={-50} max={50} format={(v) => `${v > 0 ? '+' : ''}${v} c`} onChange={(detune) => set({ detune })} />
              <div style={{ gridColumn: '1 / -1' }}>
                <Check label={`In tune (root ${noteName(Math.round(clipRoot(p, clip)))})`} checked={p.rootAuto} onChange={(rootAuto) => set({ rootAuto, root: rootAuto ? p.root : Math.round(clip.root) })} />
              </div>
              {!p.rootAuto && <Slider label="Root note" value={p.root} min={0} max={127} format={noteName} onChange={(root) => set({ root })} />}
              <Slider label="Voices" value={p.voices} min={1} max={128} onChange={(voices) => set({ voices })} />
              <div style={{ alignSelf: 'end', display: 'grid', gap: 6 }}>
                <Check label="Retrig" checked={p.retrig} onChange={(retrig) => set({ retrig })} />
                <Check label="Reverse" checked={p.reverse} onChange={(reverse) => set({ reverse })} />
                {p.mode === 'oneshot' && <Check label="Poly" checked={p.oneShotPoly} onChange={(oneShotPoly) => set({ oneShotPoly })} />}
              </div>
            </div>
          </Section>
          <Section title="Region">
            <Region p={p} clip={clip} />
            <div className="grid2" style={{ marginTop: 10 }}>
              <Slider label="Start" value={p.start} min={0} max={0.99} step={0.001} format={(v) => `${(v * clip.duration).toFixed(2)} s`} onChange={(start) => set({ start: Math.min(start, p.end - 0.01) })} />
              <Slider label="End" value={p.end} min={0.01} max={1} step={0.001} format={(v) => `${(v * clip.duration).toFixed(2)} s`} onChange={(end) => set({ end: Math.max(end, p.start + 0.01) })} />
              {p.mode === 'classic' && (
                <>
                  <div style={{ gridColumn: '1 / -1' }}><Check label="Loop while held" checked={p.loop} onChange={(loop) => set({ loop })} /></div>
                  {p.loop && (
                    <>
                      <Slider label="Loop start" value={p.loopStart} min={0} max={0.99} step={0.001} format={(v) => `${(v * clip.duration).toFixed(2)} s`} onChange={(loopStart) => set({ loopStart: Math.min(loopStart, p.loopEnd - 0.01) })} />
                      <Slider label="Loop end" value={p.loopEnd} min={0.01} max={1} step={0.001} format={(v) => `${(v * clip.duration).toFixed(2)} s`} onChange={(loopEnd) => set({ loopEnd: Math.max(loopEnd, p.loopStart + 0.01) })} />
                      <Slider label="Crossfade" value={p.xfade} min={0} max={0.5} step={0.005} format={ms} onChange={(xfade) => set({ xfade })} />
                    </>
                  )}
                </>
              )}
              {p.mode === 'slice' && (
                <>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Seg label="Slice by" value={p.sliceBy} options={[['transient', 'Transient'], ['cut', 'Cut'], ['region', 'Equal']]} onChange={(sliceBy) => set({ sliceBy })} />
                  </div>
                  {p.sliceBy === 'region' && <Slider label="Slices" value={p.sliceRegions} min={2} max={64} onChange={(sliceRegions) => set({ sliceRegions })} />}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Seg label="Playback" value={p.slicePlayback} options={[['mono', 'Mono'], ['poly', 'Poly'], ['thru', 'Thru']]} onChange={(slicePlayback) => set({ slicePlayback })} />
                  </div>
                  <p className="muted" style={{ gridColumn: '1 / -1', margin: 0 }}>{sliceTimes(p, clip).length} slices from C1. Cut slices at scene changes in the picture.</p>
                </>
              )}
            </div>
          </Section>
          <Section title="Envelope">
            <div className="grid2">
              <Slider label="Attack" value={p.env.a} min={0.001} max={2} step={0.001} format={ms} onChange={(a) => set({ env: { ...p.env, a } })} />
              <Slider label="Decay" value={p.env.d} min={0.01} max={4} step={0.01} format={ms} onChange={(d) => set({ env: { ...p.env, d } })} />
              <Slider label="Sustain" value={p.env.s} min={0} max={1} step={0.01} format={pct} onChange={(s) => set({ env: { ...p.env, s } })} />
              <Slider label="Release" value={p.env.r} min={0.03} max={6} step={0.01} format={ms} onChange={(r) => set({ env: { ...p.env, r } })} />
              <Slider label="Velocity range" value={p.velRange} min={0} max={60} format={(v) => `${v} dB`} onChange={(velRange) => set({ velRange })} />
            </div>
            <p className="muted" style={{ margin: '10px 0 0' }}>The picture fades with the sound: opacity follows the envelope in dB.</p>
          </Section>
          <Section title="Clip file">
            <div className="clipcard">
              <span className="swatch" style={{ background: rgb(clip.poster) }} />
              <span className="muted">{clip.width}×{clip.height}, {clip.fps.toFixed(0)} fps, {clip.loudness.toFixed(0)} LUFS</span>
              <button type="button" className="btn" onClick={() => app.removeClip(clip.id)}>Remove</button>
            </div>
          </Section>
        </>
      )}
    </>
  )
}

/** " (+12 c)" when the clip is off the note, nothing when it is on it. */
function fmtCents(midi: number) {
  const c = Math.round((midi - Math.round(midi)) * 100)
  return c ? ` (${c > 0 ? '+' : ''}${c} c)` : ''
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
