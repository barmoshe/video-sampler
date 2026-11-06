import { useId, type ReactNode } from 'react'

export function Slider(p: { label: string; value: number; min: number; max: number; step?: number; format?: (v: number) => string; onChange: (v: number) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="field">
      <span className="lab"><label htmlFor={id}>{p.label}</label><span className="val">{p.format ? p.format(p.value) : p.value}</span></span>
      <input id={id} type="range" min={p.min} max={p.max} step={p.step ?? 1} value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(Number(e.target.value))} />
    </div>
  )
}

export function Seg<T extends string>(p: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <fieldset className="field">
      <legend className="lab">{p.label}</legend>
      <div className="seg">
        {p.options.map(([v, l]) => <button key={v} type="button" aria-pressed={p.value === v} onClick={() => p.onChange(v)}>{l}</button>)}
      </div>
    </fieldset>
  )
}

export function Check(p: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check"><input type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />{p.label}</label>
  )
}

export function Select<T extends string>(p: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; hideLabel?: boolean }) {
  const id = useId()
  return (
    <div className="field">
      {!p.hideLabel && <label className="lab" htmlFor={id}>{p.label}</label>}
      <select id={id} aria-label={p.hideLabel ? p.label : undefined} value={p.value} onChange={(e) => p.onChange(e.target.value as T)}>
        {p.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

export function Section(p: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec" aria-label={p.title}>
      <h2>{p.title}{p.action}</h2>
      {p.children}
    </section>
  )
}

