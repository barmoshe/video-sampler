import { app } from '../engine/app'
import { selectorValue, type LayerChain, type MacroParam } from '../engine/instruments'
import { useStore } from '../engine/store'
import { noteName } from '../engine/voice-math'
import { Check, Section, Seg, Slider } from './controls'
import { rgb } from './format'

function ZoneBar({ lo, hi, fade, mark }: { lo: number; hi: number; fade: number; mark?: number }) {
  const p = (x: number) => `${(Math.max(0, Math.min(127, x)) / 127) * 100}%`
  return (
    <div className="zonebar" aria-hidden="true">
      <i style={{ left: p(lo - fade), width: `calc(${p(hi + fade)} - ${p(lo - fade)})`, opacity: 0.35 }} />
      <i style={{ left: p(lo), width: `calc(${p(hi)} - ${p(lo)})` }} />
      {mark !== undefined && <b style={{ left: p(mark) }} />}
    </div>
  )
}

function Chain({ c, sel, index }: { c: LayerChain; sel: number; index: number }) {
  const clips = useStore(app.store, (s) => s.clips)
  const clip = clips.find((x) => x.id === c.clipId)
  const set = (p: Partial<LayerChain>) => app.setLayer(c.id, p)
  return (
    <div className="chain" aria-label={`Layer ${index + 1}`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {clip ? <img className="thumb" src={clip.thumb} alt="" style={{ background: rgb(clip.poster) }} /> : <span className="thumb" />}
        <select aria-label={`Clip for layer ${index + 1}`} value={c.clipId ?? ''} onChange={(e) => set({ clipId: e.target.value || null })} style={{ flex: 1, background: 'var(--raise)', border: '1px solid var(--rule)', padding: 5 }}>
          <option value="">No clip</option>
          {clips.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button type="button" className="x" aria-label={`Remove layer ${index + 1}`} onClick={() => app.removeLayer(c.id)}>×</button>
      </div>
      <div className="field"><span className="lab">Keys <span className="val">{noteName(c.keyLo)} to {noteName(c.keyHi)}{c.keyFade ? `, fade ${c.keyFade}` : ''}</span></span><ZoneBar lo={c.keyLo} hi={c.keyHi} fade={c.keyFade} /></div>
      <div className="grid2">
        <Slider label="Key low" value={c.keyLo} min={0} max={127} format={noteName} onChange={(keyLo) => set({ keyLo: Math.min(keyLo, c.keyHi) })} />
        <Slider label="Key high" value={c.keyHi} min={0} max={127} format={noteName} onChange={(keyHi) => set({ keyHi: Math.max(keyHi, c.keyLo) })} />
        <Slider label="Key fade" value={c.keyFade} min={0} max={24} onChange={(keyFade) => set({ keyFade })} />
        <Slider label="Velocity low" value={c.velLo} min={1} max={127} onChange={(velLo) => set({ velLo: Math.min(velLo, c.velHi) })} />
        <Slider label="Velocity high" value={c.velHi} min={1} max={127} onChange={(velHi) => set({ velHi: Math.max(velHi, c.velLo) })} />
        <Slider label="Velocity fade" value={c.velFade} min={0} max={64} onChange={(velFade) => set({ velFade })} />
      </div>
      <div className="field"><span className="lab">Selector zone <span className="val">{c.selLo} to {c.selHi}</span></span><ZoneBar lo={c.selLo} hi={c.selHi} fade={c.selFade} mark={sel} /></div>
      <div className="grid2">
        <Slider label="Selector low" value={c.selLo} min={0} max={127} onChange={(selLo) => set({ selLo: Math.min(selLo, c.selHi) })} />
        <Slider label="Selector high" value={c.selHi} min={0} max={127} onChange={(selHi) => set({ selHi: Math.max(selHi, c.selLo) })} />
        <Slider label="Selector fade" value={c.selFade} min={0} max={64} onChange={(selFade) => set({ selFade })} />
        <Slider label="Transpose" value={c.transpose} min={-24} max={24} format={(v) => `${v > 0 ? '+' : ''}${v} st`} onChange={(transpose) => set({ transpose })} />
        <Slider label="Volume" value={c.volume} min={-36} max={6} format={(v) => `${v} dB`} onChange={(volume) => set({ volume })} />
        <Check label="Mute" checked={c.mute} onChange={(mute) => set({ mute })} />
      </div>
    </div>
  )
}

export function LayersPanel() {
  const L = useStore(app.store, (s) => s.layers)
  const sel = selectorValue(L)
  const macroTargets: [string, string][] = [['', 'Nothing'], ['*:selector', 'Selector'], ...L.chains.flatMap((c, i) => (['volume', 'pan', 'transpose'] as const).map((p): [string, string] => [`${c.id}:${p}`, `Layer ${i + 1} ${p}`]))]
  const ranges: Record<MacroParam, [number, number]> = { selector: [0, 127], volume: [-36, 6], pan: [-1, 1], transpose: [-12, 12] }

  const spread = () => {
    // a ready-made morph: each layer gets an equal slice of the selector with overlapping fades
    const n = L.chains.length
    if (!n) return
    const w = 128 / n
    L.chains.forEach((c, i) => app.setLayer(c.id, { selLo: Math.round(i * w), selHi: Math.round((i + 1) * w - 1), selFade: Math.round(w / 2) }))
  }

  return (
    <>
      <Section title="Layers" action={<button type="button" className="btn" onClick={() => app.addLayer()}>+ Layer</button>}>
        {!L.chains.length && <p className="muted" style={{ margin: 0 }}>Add a clip: each one becomes a layer. Layers play together, split by key or velocity, or morph with the selector.</p>}
        {L.chains.map((c, i) => <Chain key={c.id} c={c} sel={sel} index={i} />)}
      </Section>
      <Section title="Selector" action={L.chains.length > 1 ? <button type="button" className="btn" onClick={spread}>Spread layers</button> : undefined}>
        <div className="grid2">
          <div style={{ gridColumn: '1 / -1' }}>
            <Seg label="Select by" value={L.selectBy} options={[['macro', 'Macro / wheel'], ['roundrobin', 'Round robin'], ['random', 'Random']]} onChange={(selectBy) => app.setLayers({ selectBy })} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Check label="Each layer its own tile" checked={L.split} onChange={(split) => app.setLayers({ split })} />
          </div>
        </div>
        <p className="muted" style={{ margin: '10px 0 0' }}>Macro 1 and the mod wheel move the selector. With fades, turning it morphs one video into the next, sound and picture.</p>
      </Section>
      <Section title="Macros">
        <div style={{ display: 'grid', gap: 10 }}>
          {L.macros.map((m, i) => {
            const t = m.targets[0]
            const key = t ? `${t.chain}:${t.param}` : ''
            return (
              <div key={i} className="grid2" style={{ alignItems: 'end' }}>
                <Slider label={m.name} value={m.value} min={0} max={127} onChange={(v) => app.setMacro(i, v)} />
                <div className="field">
                  <label className="lab" htmlFor={`macro-${i}`}>Moves</label>
                  <select id={`macro-${i}`} value={key} style={{ background: 'var(--raise)', border: '1px solid var(--rule)', padding: 5 }} onChange={(e) => {
                    const [chain, param] = e.target.value.split(':') as [string, MacroParam]
                    const targets = e.target.value ? [{ chain, param, min: ranges[param][0], max: ranges[param][1] }] : []
                    app.setLayers({ macros: L.macros.map((x, j) => (j === i ? { ...x, targets, name: e.target.value ? (macroTargets.find(([k]) => k === e.target.value)?.[1] ?? x.name) : `Macro ${i + 1}` } : x)) })
                  }}>
                    {macroTargets.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      </Section>
      <Section title="All layers">
        <div className="grid2">
          <Slider label="Voices" value={L.voices} min={1} max={128} onChange={(voices) => app.setLayers({ voices })} />
          <Slider label="Release" value={L.env.r} min={0.03} max={6} step={0.01} format={(v) => `${v.toFixed(2)} s`} onChange={(r) => app.setLayers({ env: { ...L.env, r } })} />
        </div>
      </Section>
    </>
  )
}
