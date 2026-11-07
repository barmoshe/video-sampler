import { useRef } from 'react'
import { app } from '../engine/app'
import { Close } from './icons'
import { clipRoot, homeKey, sliceTimes, type ClipParams, type LayerChain, type Tune } from '../engine/instruments'
import { useStore } from '../engine/store'
import { noteName } from '../engine/voice-math'
import { rgb } from './format'
import { PadGrid } from './PadGrid'
import { SampleEditor } from './SampleEditor'
import { ui } from './ui'

function Minis<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <fieldset className="minis labelled"><legend>{label}</legend>
      {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </fieldset>
  )
}
function Toggle({ label, on, set, title }: { label: string; on: boolean; set: (v: boolean) => void; title?: string }) {
  return <button type="button" className="toggle" aria-pressed={on} onClick={() => set(!on)} title={title}>{label}</button>
}

/** The Clip: its frames over its waveform, the play mode, tuning, loop and slices. */
function ShapeClip() {
  const p = useStore(app.store, (s) => s.clip)
  const clip = useStore(app.store, (s) => s.clips.find((c) => c.id === s.clip.clipId) ?? null)
  const set = (x: Partial<ClipParams>) => app.setClip(x)
  if (!clip) return <p className="muted pad">Pick a sound in Play, or drop a video on the stage.</p>
  const home = p.mode !== 'slice' ? noteName(homeKey(p, clip)) : null
  return (
    <div className="shape-clip">
      <div className="mrow">
        <Minis label="Plays" value={p.mode} options={[['classic', 'Held'], ['oneshot', 'One-shot'], ['slice', 'Sliced']]} onChange={(mode) => set({ mode })} />
        {p.mode !== 'slice'
          ? <Minis<Tune> label="Tuned" value={p.tune} options={[['nearest', 'Nearest note'], ['original', 'As recorded'], ['manual', 'Manual']]} onChange={(tune) => set({ tune, root: tune === 'manual' ? Math.round(clipRoot(p, clip)) : p.root })} />
          : <Minis label="Slices at" value={p.sliceBy} options={[['transient', 'Hits'], ['cut', 'Cuts'], ['region', 'Equal'], ['manual', 'Mine']]} onChange={(sliceBy) => set({ sliceBy })} />}
        {p.mode === 'classic' && <Toggle label="Loop" on={p.loop} set={(loop) => set({ loop })} title="Loop between the blue handles while a key is held" />}
        <Toggle label="Reverse" on={p.reverse} set={(reverse) => set({ reverse })} />
        <span className="hint">
          {p.mode === 'slice' ? <><b>{sliceTimes(p, clip).length}</b> slices from C1; double-click to add one</> : <>home key <b>{home}</b>{clip.rootFound ? <> · sings {noteName(Math.round(clip.root))}</> : ' · no clear pitch'}</>}
        </span>
      </div>
      <SampleEditor p={p} clip={clip} height={96} help={false} />
      <div className="edfoot">
        <span>{(p.start * clip.duration).toFixed(2)} s → {(p.end * clip.duration).toFixed(2)} s of {clip.duration.toFixed(2)} s</span>
        <span>Drag the black handles for the region{p.mode === 'classic' && p.loop ? ', the blue ones for the loop' : ''}. Alt-click a slice you added to remove it.</span>
      </div>
    </div>
  )
}

/** Pads: pick a pad on the small block, then its sound and how it plays. */
function ShapePads() {
  const pads = useStore(app.store, (s) => s.pads)
  const clips = useStore(app.store, (s) => s.clips)
  const sel = pads.chains.find((c) => c.note === pads.selected)
  const clip = clips.find((c) => c.id === sel?.clipId)
  const file = useRef<HTMLInputElement>(null)
  const set = (x: Parameters<typeof app.setPad>[1]) => app.setPad(pads.selected, x)
  return (
    <div className="shape-pads">
      <div className="mini-pads"><PadGrid play={false} /></div>
      <div className="padinfo">
        <input ref={file} type="file" accept="video/*" hidden onChange={(e) => { if (e.target.files?.length) void app.importFiles([e.target.files[0]], { pad: pads.selected }); e.target.value = '' }} />
        <div className="padhead">
          {clip ? <img className="thumb big" src={clip.thumb} alt="" style={{ background: rgb(clip.poster) }} /> : <span className="thumb big" />}
          <div>
            <b>Pad {noteName(pads.selected)}</b>
            <span className="muted">{clip ? `${clip.name}, ${clip.duration.toFixed(2)} s` : 'Empty: pick a sound in Play, or load a video'}</span>
          </div>
          <button type="button" className="btn sm" onClick={() => file.current?.click()}>Load a video</button>
          {sel?.clipId && <button type="button" className="btn sm" onClick={() => set({ clipId: null })}>Clear</button>}
        </div>
        {sel?.clipId && (
          <div className="mrow">
            <Minis label="Plays" value={sel.mode} options={[['oneshot', 'One-shot'], ['classic', 'While held']]} onChange={(mode) => set({ mode })} />
            <Toggle label="In tune" on={sel.tune} set={(tune) => set({ tune })} title="A pitched clip plays exactly on a note" />
            <Toggle label="Mute" on={sel.mute} set={(mute) => set({ mute })} />
            <Toggle label="Solo" on={sel.solo} set={(solo) => set({ solo })} />
          </div>
        )}
        <p className="muted">Drag a pad onto another to swap them; hold Alt to layer it there. Drop several videos on a pad to fill the pads after it.</p>
      </div>
    </div>
  )
}

function Zone({ lo, hi, fade, max = 127, mark }: { lo: number; hi: number; fade: number; max?: number; mark?: number }) {
  const p = (x: number) => `${(Math.max(0, Math.min(max, x)) / max) * 100}%`
  return (
    <span className="zone" aria-hidden="true">
      <i style={{ left: p(lo - fade), width: `calc(${p(hi + fade)} - ${p(lo - fade)})`, opacity: 0.35 }} />
      <i style={{ left: p(lo), width: `calc(${p(hi)} - ${p(lo)})` }} />
      {mark !== undefined && <b style={{ left: p(mark) }} />}
    </span>
  )
}

/** Layers: one row per layer with its key and morph zones; the selected row is what the knobs turn. */
function ShapeLayers() {
  const L = useStore(app.store, (s) => s.layers)
  const clips = useStore(app.store, (s) => s.clips)
  const selId = useStore(ui, (u) => u.layer) ?? L.chains[0]?.id
  const spread = () => {
    const n = L.chains.length, w = 128 / n
    L.chains.forEach((c, i) => app.setLayer(c.id, { selLo: Math.round(i * w), selHi: Math.round((i + 1) * w - 1), selFade: Math.round(w / 2) }))
  }
  const row = (c: LayerChain, i: number) => {
    const clip = clips.find((x) => x.id === c.clipId)
    return (
      <div key={c.id} className={`lrow ${c.id === selId ? 'sel' : ''}`}>
        <button type="button" className="lpick" aria-pressed={c.id === selId} onClick={() => { ui.set({ layer: c.id, page: { ...ui.get().page, 'shape:layers': 'layer' } }) }} aria-label={`Layer ${i + 1}`}>
          {clip ? <img className="thumb" src={clip.thumb} alt="" style={{ background: rgb(clip.poster) }} /> : <span className="thumb" />}
          <span>{i + 1}</span>
        </button>
        <select aria-label={`Clip for layer ${i + 1}`} value={c.clipId ?? ''} onChange={(e) => app.setLayer(c.id, { clipId: e.target.value || null })}>
          <option value="">No clip</option>
          {clips.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <span className="zl">keys {noteName(c.keyLo)}–{noteName(c.keyHi)}</span><Zone lo={c.keyLo} hi={c.keyHi} fade={c.keyFade} />
        <span className="zl">morph</span><Zone lo={c.selLo} hi={c.selHi} fade={c.selFade} mark={L.selector} />
        <button type="button" className="toggle" aria-pressed={c.mute} onClick={() => app.setLayer(c.id, { mute: !c.mute })}>M</button>
        <button type="button" className="x" aria-label={`Remove layer ${i + 1}`} onClick={() => app.removeLayer(c.id)}><Close size={12} /></button>
      </div>
    )
  }
  return (
    <div className="shape-layers">
      <div className="mrow">
        <button type="button" className="btn sm" onClick={() => app.addLayer()}>+ Layer</button>
        <Minis label="Morph by" value={L.selectBy} options={[['macro', 'Macro 1'], ['roundrobin', 'Round robin'], ['random', 'Random']]} onChange={(selectBy) => app.setLayers({ selectBy })} />
        {L.chains.length > 1 && <button type="button" className="btn sm" onClick={spread} title="Give each layer an equal slice of the morph, with fades">Spread</button>}
        <Toggle label="A tile each" on={L.split} set={(split) => app.setLayers({ split })} title="Each layer its own tile" />
      </div>
      <div className="lrows">{L.chains.length ? L.chains.map(row) : <p className="muted">Add a layer: each is a clip. Layers play together, split by key or velocity, or morph with Macro 1.</p>}</div>
    </div>
  )
}

export function ShapeMode() {
  const kind = useStore(app.store, (s) => s.kind)
  return <div className="mode-body shape">{kind === 'pads' ? <ShapePads /> : kind === 'layers' ? <ShapeLayers /> : <ShapeClip />}</div>
}
