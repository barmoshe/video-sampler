import type { ReactNode } from 'react'
import { app, type AppState } from '../engine/app'
import type { FxSettings } from '../engine/fx'
import type { Sends } from '../engine/instruments'
import { useStore } from '../engine/store'
import { noteName, type FilterType, type LfoShape } from '../engine/voice-math'
import { Slider } from './controls'
import { db, fromLog, hz, ms, panText, parseHz, pct, st, toLog } from './format'
import { hud, ui, type UiState } from './ui'

/** What a knob changes, by colour: orange the tone, blue time, graphite space, violet the picture. */
type Tone = 'tone' | 'time' | 'space' | 'pic'
interface K {
  label: string; value: number; min: number; max: number; step?: number; def?: number
  format: (v: number) => string; parse?: (s: string) => number | null
  set: (v: number) => void; tone: Tone; hint?: string; off?: boolean
}
interface Page { id: string; name: string; knobs: (K | null)[]; head?: ReactNode }

const BEATS: [number, string][] = [[0.25, '1/16'], [0.5, '1/8'], [0.75, '1/8 dot'], [1, '1/4'], [1.5, '1/4 dot'], [2, '1/2']]
const RATES: [number, string][] = [[1, '1/4'], [0.5, '1/8'], [1 / 3, '1/8 T'], [0.25, '1/16'], [1 / 6, '1/16 T'], [0.125, '1/32']]
const BARS = [1, 2, 4, 8]
const GRID: [0 | 2 | 4 | 3, string][] = [[0, 'Free'], [2, '1/8'], [4, '1/16'], [3, '1/8 T']]
const near = <T,>(list: [number, T][], v: number) => list.reduce((b, x, i) => (Math.abs(x[0] - v) < Math.abs(list[b][0] - v) ? i : b), 0)

/** The two sends of whatever is selected, then the bus they feed (the Effects returns and glue). */
function space(sends: Sends | undefined, set: (s: Sends) => void, fx: FxSettings, off = false): (K | null)[] {
  const s = sends ?? { delay: 0, reverb: 0 }
  return [
    { label: 'Delay', value: s.delay, min: 0, max: 1, step: 0.01, format: pct, set: (delay) => set({ ...s, delay }), tone: 'space', hint: 'the tile echoes', off },
    { label: 'Reverb', value: s.reverb, min: 0, max: 1, step: 0.01, format: pct, set: (reverb) => set({ ...s, reverb }), tone: 'space', hint: 'a glow lingers', off },
    ...bus(fx).slice(0, 6),
  ]
}
function bus(fx: FxSettings): K[] {
  return [
    { label: 'Time', value: near(BEATS, fx.delay.beats), min: 0, max: BEATS.length - 1, format: (i) => BEATS[i][1], set: (i) => app.setFx({ delay: { ...fx.delay, beats: BEATS[i][0] } }), tone: 'time', hint: 'echoes on the beat' },
    { label: 'Feedback', value: fx.delay.feedback, min: 0, max: 0.9, step: 0.01, format: pct, set: (feedback) => app.setFx({ delay: { ...fx.delay, feedback } }), tone: 'space', hint: 'more echoes' },
    { label: 'Decay', value: fx.reverb.decay, min: 0.3, max: 6, step: 0.1, format: (v) => `${v.toFixed(1)} s`, set: (decay) => app.setFx({ reverb: { ...fx.reverb, decay } }), tone: 'time', hint: 'the glow lasts as long' },
    { label: 'D return', value: fx.delay.level, min: 0, max: 1, step: 0.01, format: pct, set: (level) => app.setFx({ delay: { ...fx.delay, level } }), tone: 'space' },
    { label: 'R return', value: fx.reverb.level, min: 0, max: 1, step: 0.01, format: pct, set: (level) => app.setFx({ reverb: { ...fx.reverb, level } }), tone: 'space' },
    { label: 'Glue', value: fx.glue, min: 0, max: 1, step: 0.01, format: pct, set: (glue) => app.setFx({ glue }), tone: 'space', hint: 'the mix holds together' },
    { label: 'D tone', value: fx.delay.tone, min: 500, max: 12000, step: 100, format: hz, set: (tone) => app.setFx({ delay: { ...fx.delay, tone } }), tone: 'tone' },
    { label: 'R tone', value: fx.reverb.tone, min: 1000, max: 16000, step: 100, format: hz, set: (tone) => app.setFx({ reverb: { ...fx.reverb, tone } }), tone: 'tone' },
  ]
}

function Segs<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <fieldset className="minis"><legend className="sr">{label}</legend>
      {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </fieldset>
  )
}

function clipPages(s: AppState): Page[] {
  const p = s.clip, set = (x: Partial<typeof p>) => app.setClip(x), f = p.filter, l = p.lfo, e = p.env
  const off = !p.clipId, foff = off || f.type === 'off'
  const cutoff: K = { label: 'Cutoff', value: toLog(f.cutoff), min: 0, max: 1000, def: toLog(2000), format: (v) => hz(fromLog(v)), parse: parseHz, set: (v) => set({ filter: { ...f, cutoff: fromLog(v), type: f.type === 'off' ? 'lp' : f.type } }), tone: 'tone', hint: f.type === 'hp' ? 'only the edges stay' : 'the tile blurs', off }
  const res: K = { label: 'Resonance', value: f.res, min: 0, max: 1, step: 0.01, format: pct, set: (res) => set({ filter: { ...f, res } }), tone: 'tone', hint: 'the edges glow', off: foff }
  const attack: K = { label: 'Attack', value: e.a, min: 0.001, max: 2, step: 0.001, format: ms, set: (a) => set({ env: { ...e, a } }), tone: 'time', hint: 'the tile fades in', off }
  const release: K = { label: 'Release', value: e.r, min: 0.03, max: 6, step: 0.01, format: ms, set: (r) => set({ env: { ...e, r } }), tone: 'time', hint: 'the tile fades out', off }
  const transpose: K = { label: 'Transpose', value: p.transpose, min: -48, max: 48, format: st, set: (transpose) => set({ transpose }), tone: 'tone', hint: 'the clip plays faster or slower', off }
  return [
    { id: 'quick', name: 'Quick', knobs: [transpose, cutoff, res,
      { label: 'Wobble', value: l.filter, min: 0, max: 4, step: 0.05, format: (v) => `${v.toFixed(2)} oct`, set: (v) => set({ lfo: { ...l, filter: v }, filter: { ...f, type: f.type === 'off' && v > 0 ? 'lp' : f.type } }), tone: 'time', hint: 'the blur breathes', off },
      attack, release, ...space(p.sends, (sends) => set({ sends }), s.fx, off).slice(0, 2)] },
    { id: 'voice', name: 'Voice', knobs: [transpose,
      { label: 'Detune', value: p.detune, min: -50, max: 50, format: (v) => `${v > 0 ? '+' : ''}${v} c`, set: (detune) => set({ detune }), tone: 'tone', off },
      attack,
      { label: 'Decay', value: e.d, min: 0.01, max: 4, step: 0.01, format: ms, set: (d) => set({ env: { ...e, d } }), tone: 'time', off },
      { label: 'Sustain', value: e.s, min: 0, max: 1, step: 0.01, format: pct, set: (sv) => set({ env: { ...e, s: sv } }), tone: 'time', hint: 'the held picture stays this bright', off },
      release,
      { label: 'Velocity', value: p.velRange, min: 0, max: 60, format: (v) => `${v} dB`, set: (velRange) => set({ velRange }), tone: 'space', hint: 'soft notes are dimmer tiles', off },
      { label: 'Voices', value: p.voices, min: 1, max: 128, format: String, set: (voices) => set({ voices }), tone: 'space', off }] },
    { id: 'filter', name: 'Filter',
      head: <Segs<FilterType> label="Filter type" value={f.type} options={[['off', 'Off'], ['lp', 'Low'], ['hp', 'High'], ['bp', 'Band'], ['notch', 'Notch']]} onChange={(type) => set({ filter: { ...f, type, cutoff: type === 'hp' && f.cutoff > 10000 ? 200 : type === 'lp' && f.cutoff > 16000 ? 2000 : f.cutoff } })} />,
      knobs: [{ ...cutoff, off: foff }, res,
        { label: 'Drive', value: f.drive, min: 0, max: 1, step: 0.01, format: pct, set: (drive) => set({ filter: { ...f, drive } }), tone: 'tone', hint: 'the contrast rises', off },
        { label: 'Key track', value: f.key, min: 0, max: 1, step: 0.05, format: pct, set: (key) => set({ filter: { ...f, key } }), tone: 'tone', off: foff },
        { label: 'Env amount', value: f.envAmt, min: -8, max: 8, step: 0.1, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} oct`, set: (envAmt) => set({ filter: { ...f, envAmt } }), tone: 'time', hint: 'each note sweeps the blur', off: foff },
        { label: 'Env attack', value: f.env.a, min: 0.001, max: 2, step: 0.001, format: ms, set: (a) => set({ filter: { ...f, env: { ...f.env, a } } }), tone: 'time', off: foff || !f.envAmt },
        { label: 'Env decay', value: f.env.d, min: 0.01, max: 4, step: 0.01, format: ms, set: (d) => set({ filter: { ...f, env: { ...f.env, d } } }), tone: 'time', off: foff || !f.envAmt },
        { label: 'Env sustain', value: f.env.s, min: 0, max: 1, step: 0.01, format: pct, set: (sv) => set({ filter: { ...f, env: { ...f.env, s: sv } } }), tone: 'time', off: foff || !f.envAmt }] },
    { id: 'motion', name: 'Motion',
      head: <Segs<LfoShape> label="LFO shape" value={l.shape} options={[['sine', 'Sine'], ['triangle', 'Tri'], ['saw', 'Saw'], ['square', 'Square'], ['random', 'Random']]} onChange={(shape) => set({ lfo: { ...l, shape } })} />,
      knobs: [
        { label: 'Rate', value: Math.round(Math.log2(l.rate / 0.05) * 100), min: 0, max: 900, format: () => `${l.rate < 1 ? l.rate.toFixed(2) : l.rate.toFixed(1)} Hz`, set: (v) => set({ lfo: { ...l, rate: 0.05 * Math.pow(2, v / 100) } }), tone: 'time', off },
        { label: 'To filter', value: l.filter, min: 0, max: 4, step: 0.05, format: (v) => `${v.toFixed(2)} oct`, set: (v) => set({ lfo: { ...l, filter: v }, filter: { ...f, type: f.type === 'off' && v > 0 ? 'lp' : f.type } }), tone: 'tone', hint: 'the blur breathes', off },
        { label: 'To volume', value: l.volume, min: 0, max: 1, step: 0.01, format: pct, set: (volume) => set({ lfo: { ...l, volume } }), tone: 'space', hint: 'the tile pulses', off },
        { label: 'To pan', value: l.pan, min: 0, max: 1, step: 0.01, format: pct, set: (pan) => set({ lfo: { ...l, pan } }), tone: 'space', off },
        { label: 'Bend range', value: s.bendRange, min: 1, max: 24, format: (v) => `±${v} st`, set: (v) => app.set('bendRange', v), tone: 'tone' },
        { label: 'Crossfade', value: p.xfade, min: 0, max: 0.5, step: 0.005, format: ms, set: (xfade) => set({ xfade }), tone: 'time', hint: 'the loop seam softens', off: off || !p.loop || p.mode !== 'classic' },
        null, null] },
    { id: 'space', name: 'Space', knobs: space(p.sends, (sends) => set({ sends }), s.fx, off) },
  ]
}

function padPages(s: AppState): Page[] {
  const sel = s.pads.chains.find((c) => c.note === s.pads.selected)
  const off = !sel?.clipId
  const set = (x: Parameters<typeof app.setPad>[1]) => app.setPad(s.pads.selected, x)
  const e = sel?.env ?? { a: 0.002, d: 1, s: 1, r: 0.05 }
  const pitch: K = { label: 'Pitch', value: sel?.playNote ?? 60, min: 36, max: 84, def: 60, format: (v) => `${noteName(v)}${v === 60 ? ' (orig.)' : ''}`, set: (playNote) => set({ playNote }), tone: 'tone', hint: 'faster or slower', off }
  const volume: K = { label: 'Volume', value: sel?.volume ?? 0, min: -36, max: 6, def: 0, format: db, set: (volume) => set({ volume }), tone: 'space', hint: 'the tile dims', off }
  const pan: K = { label: 'Pan', value: sel?.pan ?? 0, min: -1, max: 1, step: 0.05, def: 0, format: panText, set: (pan) => set({ pan }), tone: 'space', off }
  const attack: K = { label: 'Attack', value: e.a, min: 0.001, max: 2, step: 0.001, format: ms, set: (a) => set({ env: { ...e, a } }), tone: 'time', hint: 'the tile fades in', off }
  const release: K = { label: 'Release', value: e.r, min: 0.03, max: 4, step: 0.01, format: ms, set: (r) => set({ env: { ...e, r } }), tone: 'time', hint: 'the tile fades out', off }
  const play = s.padPlay
  return [
    { id: 'quick', name: 'Quick', knobs: [pitch, volume, pan,
      { label: 'Choke', value: sel?.choke ?? 0, min: 0, max: 16, format: (v) => (v ? `group ${v}` : 'none'), set: (choke) => set({ choke }), tone: 'time', hint: 'pads in a group cut each other', off },
      attack, release, ...space(sel?.sends, (sends) => set({ sends }), s.fx, off).slice(0, 2)] },
    { id: 'pad', name: 'Pad', knobs: [pitch, volume, pan,
      { label: 'Trim', value: sel?.trim ?? 0, min: -12, max: 12, step: 0.5, def: 0, format: (v) => `${v.toFixed(1)} dB`, set: (trim) => set({ trim }), tone: 'space', off },
      attack,
      { label: 'Decay', value: e.d, min: 0.01, max: 4, step: 0.01, format: ms, set: (d) => set({ env: { ...e, d } }), tone: 'time', off },
      { label: 'Sustain', value: e.s, min: 0, max: 1, step: 0.01, format: pct, set: (sv) => set({ env: { ...e, s: sv } }), tone: 'time', off },
      release] },
    { id: 'repeat', name: 'Repeat',
      head: (
        <fieldset className="minis"><legend className="sr">Pad modes</legend>
          <button type="button" aria-pressed={play.repeat} onClick={() => app.setPadPlay({ repeat: !play.repeat })}>Note repeat</button>
          <button type="button" aria-pressed={play.levels} onClick={() => app.setPadPlay({ levels: !play.levels })}>16 Levels</button>
        </fieldset>
      ),
      knobs: [
        { label: 'Rate', value: near(RATES, play.rate), min: 0, max: RATES.length - 1, format: (i) => RATES[i][1], set: (i) => app.setPadPlay({ rate: RATES[i][0] }), tone: 'time', hint: 'a held pad repeats on the grid', off: !play.repeat },
        { label: 'Swing', value: play.swing, min: 0, max: 0.5, step: 0.01, def: 0, format: (v) => `${Math.round(50 + v * 50)} %`, set: (swing) => app.setPadPlay({ swing }), tone: 'time', off: !play.repeat },
        { label: 'Velocity', value: s.velocity, min: 1, max: 127, format: String, set: (v) => app.set('velocity', v), tone: 'space', hint: 'how hard a click plays' },
        { label: 'Kit voices', value: s.pads.voices, min: 1, max: 128, format: String, set: (voices) => app.setPads({ voices }), tone: 'space' },
        null, null, null, null] },
    { id: 'space', name: 'Space', knobs: space(sel?.sends, (sends) => set({ sends }), s.fx, off) },
  ]
}

function layerPages(s: AppState, u: UiState): Page[] {
  const L = s.layers
  const c = L.chains.find((x) => x.id === u.layer) ?? L.chains[0]
  const off = !c
  const set = (x: Parameters<typeof app.setLayer>[1]) => c && app.setLayer(c.id, x)
  return [
    { id: 'macros', name: 'Macros', knobs: L.macros.map((m, i): K => ({ label: m.name, value: m.value, min: 0, max: 127, format: String, set: (v) => app.setMacro(i, v), tone: i === 0 ? 'pic' : 'tone', hint: i === 0 && m.targets[0]?.param === 'selector' ? 'one video morphs into the next' : undefined })) },
    { id: 'layer', name: 'Layer', knobs: [
      { label: 'Transpose', value: c?.transpose ?? 0, min: -24, max: 24, def: 0, format: st, set: (transpose) => set({ transpose }), tone: 'tone', off },
      { label: 'Volume', value: c?.volume ?? 0, min: -36, max: 6, def: 0, format: db, set: (volume) => set({ volume }), tone: 'space', off },
      { label: 'Pan', value: c?.pan ?? 0, min: -1, max: 1, step: 0.05, def: 0, format: panText, set: (pan) => set({ pan }), tone: 'space', off },
      { label: 'Key low', value: c?.keyLo ?? 0, min: 0, max: 127, format: noteName, set: (keyLo) => c && set({ keyLo: Math.min(keyLo, c.keyHi) }), tone: 'tone', off },
      { label: 'Key high', value: c?.keyHi ?? 127, min: 0, max: 127, format: noteName, set: (keyHi) => c && set({ keyHi: Math.max(keyHi, c.keyLo) }), tone: 'tone', off },
      { label: 'Vel low', value: c?.velLo ?? 1, min: 1, max: 127, format: String, set: (velLo) => c && set({ velLo: Math.min(velLo, c.velHi) }), tone: 'space', off },
      { label: 'Vel high', value: c?.velHi ?? 127, min: 1, max: 127, format: String, set: (velHi) => c && set({ velHi: Math.max(velHi, c.velLo) }), tone: 'space', off },
      { label: 'Sel fade', value: c?.selFade ?? 0, min: 0, max: 64, format: String, set: (selFade) => set({ selFade }), tone: 'pic', hint: 'how far the morph blends', off }] },
    { id: 'all', name: 'All', knobs: [
      { label: 'Attack', value: L.env.a, min: 0.001, max: 2, step: 0.001, format: ms, set: (a) => app.setLayers({ env: { ...L.env, a } }), tone: 'time', hint: 'the tiles fade in' },
      { label: 'Release', value: L.env.r, min: 0.03, max: 6, step: 0.01, format: ms, set: (r) => app.setLayers({ env: { ...L.env, r } }), tone: 'time', hint: 'the tiles fade out' },
      { label: 'Voices', value: L.voices, min: 1, max: 128, format: String, set: (voices) => app.setLayers({ voices }), tone: 'space' },
      { label: 'Velocity', value: s.velocity, min: 1, max: 127, format: String, set: (v) => app.set('velocity', v), tone: 'space' },
      null, null, null, null] },
    { id: 'space', name: 'Space', knobs: space(L.sends, (sends) => app.setLayers({ sends }), s.fx) },
  ]
}

function loopPages(s: AppState): Page[] {
  const tr = s.transport, m = s.main
  return [{ id: 'transport', name: 'Transport', knobs: [
    { label: 'Tempo', value: tr.bpm, min: 40, max: 240, format: (v) => `${v} BPM`, set: (bpm) => app.setTransport({ bpm }), tone: 'time', hint: 'the delay follows' },
    { label: 'Bars', value: Math.max(0, BARS.indexOf(tr.bars)), min: 0, max: BARS.length - 1, format: (i) => `${BARS[i]} bar${BARS[i] > 1 ? 's' : ''}`, set: (i) => app.setTransport({ bars: BARS[i] }), tone: 'time', hint: 'the loop length' },
    { label: 'Grid', value: Math.max(0, GRID.findIndex((g) => g[0] === tr.quantize)), min: 0, max: GRID.length - 1, format: (i) => GRID[i][1], set: (i) => app.setTransport({ quantize: GRID[i][0] }), tone: 'time', hint: 'recorded notes snap to it' },
    { label: 'Beats', value: tr.beats, min: 2, max: 7, format: (v) => `${v} / 4`, set: (beats) => app.setTransport({ beats }), tone: 'time' },
    { label: 'Main sound', value: m.gain, min: 0, max: 1, step: 0.05, format: pct, set: (gain) => app.setMain({ gain }), tone: 'space', off: !m.clipId },
    { label: 'Main picture', value: m.alpha, min: 0, max: 1, step: 0.05, format: pct, set: (alpha) => app.setMain({ alpha }), tone: 'pic', hint: 'the video behind fades', off: !m.clipId },
    { label: 'Velocity', value: s.velocity, min: 1, max: 127, format: String, set: (v) => app.set('velocity', v), tone: 'space' },
    null] }, { id: 'space', name: 'Effects', knobs: bus(s.fx) }]
}

function postPages(s: AppState): Page[] {
  const lk = s.look, set = (x: Partial<typeof lk>) => app.set('look', { ...lk, ...x })
  return [
    { id: 'look', name: 'Look', knobs: [
      { label: 'Gap', value: lk.gap, min: 0, max: 0.05, step: 0.001, format: (v) => `${(v * 100).toFixed(1)} %`, set: (gap) => set({ gap }), tone: 'pic', hint: 'space between the tiles' },
      { label: 'Corners', value: lk.radius, min: 0, max: 0.1, step: 0.002, format: (v) => `${(v * 100).toFixed(1)} %`, set: (radius) => set({ radius }), tone: 'pic' },
      { label: 'Border', value: lk.border, min: 0, max: 0.012, step: 0.001, format: (v) => `${(v * 100).toFixed(1)} %`, set: (border) => set({ border }), tone: 'pic' },
      { label: 'Pop', value: lk.pop, min: 0, max: 0.25, step: 0.01, format: (v) => `${Math.round(v * 100)} %`, set: (pop) => set({ pop }), tone: 'pic', hint: 'a hit bumps its tile' },
      { label: 'Main picture', value: s.main.alpha, min: 0, max: 1, step: 0.05, format: pct, set: (alpha) => app.setMain({ alpha }), tone: 'pic', off: !s.main.clipId },
      null, null, null] },
    { id: 'mix', name: 'Mix', knobs: bus(s.fx) },
  ]
}

function pagesFor(s: AppState, u: UiState): Page[] {
  if (u.mode === 'loop') return loopPages(s)
  if (u.mode === 'post') return postPages(s)
  return s.kind === 'pads' ? padPages(s) : s.kind === 'layers' ? layerPages(s, u) : clipPages(s)
}

/** What the knobs are on, in a few words. */
function targetName(s: AppState, u: UiState) {
  if (u.mode === 'loop') return `${s.transport.bpm} BPM · ${s.transport.bars} bar${s.transport.bars > 1 ? 's' : ''}`
  if (u.mode === 'post') return 'The picture'
  const name = (id: string | null | undefined) => s.clips.find((c) => c.id === id)?.name
  if (s.kind === 'pads') { const sel = s.pads.chains.find((c) => c.note === s.pads.selected); return `Pad ${noteName(s.pads.selected)}${name(sel?.clipId) ? ` · ${name(sel?.clipId)}` : ''}` }
  if (s.kind === 'layers') { const i = Math.max(0, s.layers.chains.findIndex((c) => c.id === u.layer)); const c = s.layers.chains[i]; return c ? `Layer ${i + 1}${name(c.clipId) ? ` · ${name(c.clipId)}` : ''}` : 'No layers yet' }
  return name(s.clip.clipId) ?? 'No clip yet'
}

/**
 * Eight knobs that follow the selection (Push, Move): pages for each instrument and mode, colour-coded
 * by what they change, the value popping up over the stage while turning. "More" opens the full editor.
 */
export function DeckKnobs() {
  const s = useStore(app.store, (x) => x)
  const u = useStore(ui, (x) => x)
  const pages = pagesFor(s, u)
  const key = u.mode === 'loop' || u.mode === 'post' ? u.mode : `${u.mode}:${s.kind}`
  const cur = pages.find((p) => p.id === u.page[key]) ?? pages[0]
  const target = targetName(s, u)
  // the knobs remount when the selection changes (each keeps the default its first value set), not when a value does
  const selection = u.mode === 'loop' || u.mode === 'post' ? u.mode : s.kind === 'pads' ? s.pads.selected : s.kind === 'layers' ? u.layer ?? s.layers.chains[0]?.id : s.clip.clipId
  return (
    <section className="knobs" aria-label="Knobs">
      <header>
        <span className="target" title={target}>{target}</span>
        <nav className="pages" aria-label="Knob pages">
          {pages.map((p) => <button key={p.id} type="button" aria-pressed={p === cur} onClick={() => ui.set({ page: { ...u.page, [key]: p.id } })}>{p.name}</button>)}
        </nav>
        {(u.mode === 'play' || u.mode === 'shape') && <button type="button" className="more" aria-pressed={u.sheet} onClick={() => ui.set({ sheet: !u.sheet })} title="Every setting for this instrument">More</button>}
      </header>
      <div className="khead">{cur.head}</div>
      <div className="kgrid">
        {cur.knobs.map((k, i) => k
          ? (
            <div key={`${cur.id}:${i}:${selection}`} className={`kslot t-${k.tone}`}>
              <Slider label={k.label} value={k.value} min={k.min} max={k.max} step={k.step} def={k.def} format={k.format} parse={k.parse} disabled={k.off}
                onChange={(v) => { k.set(v); hud(k.label, k.format(v), k.hint) }} />
            </div>
          )
          : <div key={`${cur.id}:${i}`} className="kslot blank" aria-hidden="true"><span /></div>)}
      </div>
    </section>
  )
}
