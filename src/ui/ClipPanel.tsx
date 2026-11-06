import { app } from '../engine/app'
import { clipRoot, homeKey, homeSpeed, sliceTimes, type ClipParams, type Sends, type Tune } from '../engine/instruments'
import { useStore } from '../engine/store'
import type { Clip } from '../engine/types'
import { noteName, type FilterSpec, type FilterType, type LfoShape, type LfoSpec } from '../engine/voice-math'
import { Check, Section, Seg, Slider } from './controls'
import { SampleEditor } from './SampleEditor'
import { ms, pct, rgb } from './format'

export function ClipList({ selected, onPick }: { selected: string | null; onPick: (id: string) => void }) {
  const clips = useStore(app.store, (s) => s.clips)
  if (!clips.length) return <p className="muted">No clips yet.</p>
  return (
    <div className="clips">
      {clips.map((c) => (
        <button type="button" key={c.id} className="cliprow" aria-pressed={c.id === selected} onClick={() => onPick(c.id)}>
          <img className="thumb" src={c.thumb} alt="" style={{ background: rgb(c.poster) }} />
          <span>{c.name}</span>
          <span className="muted">{c.duration.toFixed(1)} s</span>
        </button>
      ))}
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
              ? <>Sings <b style={{ color: 'var(--ink)' }}>{noteName(Math.round(clip.root))}</b>{fmtCents(clip.root)}.</>
              : 'No clear pitch.'}
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
              <Slider label="Voices" value={p.voices} min={1} max={128} onChange={(voices) => set({ voices })} />
              <div style={{ alignSelf: 'end', display: 'grid', gap: 6 }}>
                <Check label="Retrig" checked={p.retrig} onChange={(retrig) => set({ retrig })} />
                <Check label="Reverse" checked={p.reverse} onChange={(reverse) => set({ reverse })} />
                {p.mode === 'oneshot' && <Check label="Poly" checked={p.oneShotPoly} onChange={(oneShotPoly) => set({ oneShotPoly })} />}
              </div>
            </div>
          </Section>
          {p.mode !== 'slice' && (
            <Section title="Tune">
              <Seg<Tune> label="Tune to" value={p.tune} options={[['nearest', 'Nearest note'], ['original', 'As recorded'], ['manual', 'Manual']]} onChange={(tune) => set({ tune, root: tune === 'manual' ? Math.round(clipRoot(p, clip)) : p.root })} />
              {p.tune === 'manual' && <Slider label="Root note" value={p.root} min={0} max={127} format={noteName} onChange={(root) => set({ root })} />}
              <p className="muted" style={{ margin: '10px 0 0' }}>{tuneText(p, clip)}</p>
            </Section>
          )}
          <Section title="Region">
            <SampleEditor p={p} clip={clip} />
            <div className="grid2" style={{ marginTop: 10 }}>
              <Slider kind="slider" label="Start" value={p.start} min={0} max={0.99} step={0.001} format={(v) => `${(v * clip.duration).toFixed(2)} s`} onChange={(start) => set({ start: Math.min(start, p.end - 0.01) })} />
              <Slider kind="slider" label="End" value={p.end} min={0.01} max={1} step={0.001} format={(v) => `${(v * clip.duration).toFixed(2)} s`} onChange={(end) => set({ end: Math.max(end, p.start + 0.01) })} />
              {p.mode === 'classic' && (
                <>
                  <div style={{ gridColumn: '1 / -1' }}><Check label="Loop while held" checked={p.loop} onChange={(loop) => set({ loop })} /></div>
                  {p.loop && (
                    <>
                      <Slider kind="slider" label="Loop start" value={p.loopStart} min={0} max={0.99} step={0.001} format={(v) => `${(v * clip.duration).toFixed(2)} s`} onChange={(loopStart) => set({ loopStart: Math.min(loopStart, p.loopEnd - 0.01) })} />
                      <Slider kind="slider" label="Loop end" value={p.loopEnd} min={0.01} max={1} step={0.001} format={(v) => `${(v * clip.duration).toFixed(2)} s`} onChange={(loopEnd) => set({ loopEnd: Math.max(loopEnd, p.loopStart + 0.01) })} />
                      <Slider label="Crossfade" value={p.xfade} min={0} max={0.5} step={0.005} format={ms} onChange={(xfade) => set({ xfade })} />
                    </>
                  )}
                </>
              )}
              {p.mode === 'slice' && (
                <>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Seg label="Slice by" value={p.sliceBy} options={[['transient', 'Transient'], ['cut', 'Cut'], ['region', 'Equal'], ['manual', 'Manual']]} onChange={(sliceBy) => set({ sliceBy })} />
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
          <FilterSection filter={p.filter} onChange={(filter) => set({ filter })} />
          <LfoSection lfo={p.lfo} onChange={(lfo) => set({ lfo })} />
          <SendsSection sends={p.sends} onChange={(sends) => set({ sends })} />
          <Section title="Clip file">
            <div className="clipcard">
              <img className="thumb big" src={clip.thumb} alt="" style={{ background: rgb(clip.poster) }} />
              <span className="muted">{clip.width}×{clip.height}, {clip.fps.toFixed(0)} fps, {clip.loudness.toFixed(0)} LUFS</span>
              <button type="button" className="btn" onClick={() => app.removeClip(clip.id)}>Remove</button>
            </div>
          </Section>
        </>
      )}
    </>
  )
}

const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`)
const toLog = (hzv: number) => Math.round((Math.log(hzv / 20) / Math.log(1000)) * 1000)
const fromLog = (x: number) => 20 * Math.pow(1000, x / 1000)

/** Filter with its envelope; the tile shows it (blur, edges, glow, drive). */
export function FilterSection({ filter: f, onChange }: { filter: FilterSpec; onChange: (f: FilterSpec) => void }) {
  const set = (x: Partial<FilterSpec>) => onChange({ ...f, ...x })
  const fe = f.env
  const off = f.type === 'off'
  return (
    <Section title="Filter">
      <Seg<FilterType> label="Type" value={f.type} options={[['off', 'Off'], ['lp', 'Low-pass'], ['hp', 'High-pass'], ['bp', 'Band'], ['notch', 'Notch']]} onChange={(type) => set({ type, cutoff: type === 'hp' && f.cutoff > 10000 ? 200 : type === 'lp' && f.cutoff > 16000 ? 2000 : f.cutoff })} />
      <div className="grid2" style={{ marginTop: 10 }}>
        <Slider label="Cutoff" value={toLog(f.cutoff)} min={0} max={1000} format={(v) => hz(fromLog(v))} onChange={(v) => set({ cutoff: fromLog(v) })} disabled={off} def={toLog(2000)}
          parse={(s) => { const m = /^\s*(\d*\.?\d+)\s*(k)?/i.exec(s); return m ? toLog(Math.max(20, Math.min(20000, Number(m[1]) * (m[2] ? 1000 : 1)))) : null }} />
        <Slider label="Resonance" value={f.res} min={0} max={1} step={0.01} format={pct} onChange={(res) => set({ res })} disabled={off} />
        <Slider label="Drive" value={f.drive} min={0} max={1} step={0.01} format={pct} onChange={(drive) => set({ drive })} />
        <Slider label="Key track" value={f.key} min={0} max={1} step={0.05} format={pct} onChange={(key) => set({ key })} disabled={off} />
        <Slider label="Envelope" value={f.envAmt} min={-8} max={8} step={0.1} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} oct`} onChange={(envAmt) => set({ envAmt })} disabled={off} />
        <Slider label="Env attack" value={fe.a} min={0.001} max={2} step={0.001} format={ms} onChange={(a) => set({ env: { ...fe, a } })} disabled={off || !f.envAmt} />
        <Slider label="Env decay" value={fe.d} min={0.01} max={4} step={0.01} format={ms} onChange={(d) => set({ env: { ...fe, d } })} disabled={off || !f.envAmt} />
        <Slider label="Env sustain" value={fe.s} min={0} max={1} step={0.01} format={pct} onChange={(sv) => set({ env: { ...fe, s: sv } })} disabled={off || !f.envAmt} />
      </div>
      <p className="muted" style={{ margin: '10px 0 0' }}>The picture follows: low-pass blurs the tile octave for octave, high-pass leaves its edges, resonance makes them glow, drive adds contrast.</p>
    </Section>
  )
}

/** One LFO to the filter, the volume and the pan; the tile follows it. */
export function LfoSection({ lfo: l, onChange }: { lfo: LfoSpec; onChange: (l: LfoSpec) => void }) {
  const set = (x: Partial<LfoSpec>) => onChange({ ...l, ...x })
  return (
    <Section title="LFO">
      <Seg<LfoShape> label="Shape" value={l.shape} options={[['sine', 'Sine'], ['triangle', 'Tri'], ['saw', 'Saw'], ['square', 'Square'], ['random', 'Random']]} onChange={(shape) => set({ shape })} />
      <div className="grid2" style={{ marginTop: 10 }}>
        <Slider label="Rate" value={Math.round(Math.log2(l.rate / 0.05) * 100)} min={0} max={900} format={() => `${l.rate < 1 ? l.rate.toFixed(2) : l.rate.toFixed(1)} Hz`} onChange={(v) => set({ rate: 0.05 * Math.pow(2, v / 100) })} />
        <div style={{ alignSelf: 'end' }}><Check label="Restart on each note" checked={l.retrig} onChange={(retrig) => set({ retrig })} /></div>
        <Slider label="To filter" value={l.filter} min={0} max={4} step={0.05} format={(v) => `${v.toFixed(2)} oct`} onChange={(filter) => set({ filter })} />
        <Slider label="To volume" value={l.volume} min={0} max={1} step={0.01} format={pct} onChange={(volume) => set({ volume })} />
        <Slider label="To pan" value={l.pan} min={0} max={1} step={0.01} format={pct} onChange={(pan) => set({ pan })} />
      </div>
    </Section>
  )
}

/** Sends to the effects bus's delay and reverb (their settings: Effects in the header). */
export function SendsSection({ sends, onChange }: { sends: Sends; onChange: (s: Sends) => void }) {
  return (
    <Section title="Sends">
      <div className="grid2">
        <Slider label="Delay" value={sends.delay} min={0} max={1} step={0.01} format={pct} onChange={(delay) => onChange({ ...sends, delay })} />
        <Slider label="Reverb" value={sends.reverb} min={0} max={1} step={0.01} format={pct} onChange={(reverb) => onChange({ ...sends, reverb })} />
      </div>
      <p className="muted" style={{ margin: '10px 0 0' }}>The tile echoes with the delay and glows with the reverb.</p>
    </Section>
  )
}

/** What the Tune setting does to this clip, in one sentence. */
function tuneText(p: ClipParams, clip: Clip): string {
  const home = noteName(homeKey(p, clip))
  const sp = homeSpeed(p, clip), pc = Math.abs(sp - 1) * 100
  const speed = pc < 0.05 ? 'at its recorded speed' : `${pc.toFixed(1)} % ${sp > 1 ? 'faster' : 'slower'} than recorded`
  if (p.tune === 'nearest') {
    return clip.rootFound
      ? `Its home key ${home} plays it exactly in tune, ${speed}. Every other key is in tune too.`
      : `No clear pitch, so it plays as recorded on ${home}.`
  }
  if (p.tune === 'original') return `Plays as recorded on ${home}${clip.rootFound ? `, at its own pitch (${noteName(Math.round(clip.root))}${fmtCents(clip.root)}), so other keys may sound off the note` : ''}.`
  return `${home} plays it as recorded. Use Detune for cents.`
}

/** " (+12 c)" when the clip is off the note, nothing when it is on it. */
function fmtCents(midi: number) {
  const c = Math.round((midi - Math.round(midi)) * 100)
  return c ? ` (${c > 0 ? '+' : ''}${c} c)` : ''
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
