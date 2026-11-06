import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
  disabled?: boolean
  def?: number // the value Alt-click returns to (default: the value it first showed)
  parse?: (typed: string) => number | null // a typed value into this control's own units
  kind?: 'knob' | 'slider' // a knob unless a linear slider reads better (times along a clip)
}

/** "2k" → 2000, "-3.5" → −3.5. */
const parseNumber = (s: string): number | null => {
  const m = /^\s*(-?\d*\.?\d+)\s*(k)?/i.exec(s)
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : null
}

export function Slider(p: SliderProps) {
  return p.kind === 'slider' ? <Linear {...p} /> : <Knob {...p} />
}

function Linear(p: SliderProps) {
  const id = useId()
  return (
    <div className="field slider">
      <span className="lab"><label htmlFor={id}>{p.label}</label><span className="val">{p.format ? p.format(p.value) : p.value}</span></span>
      <input id={id} type="range" min={p.min} max={p.max} step={p.step ?? 1} value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(Number(e.target.value))} />
    </div>
  )
}

const A0 = -135, A1 = 135 // the knob's sweep in degrees
const pt = (a: number, r: number): [number, number] => { const t = ((a - 90) * Math.PI) / 180; return [20 + r * Math.cos(t), 20 + r * Math.sin(t)] }
const arc = (a: number, b: number, r: number) => { const [x0, y0] = pt(a, r), [x1, y1] = pt(b, r); return `M ${x0} ${y0} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x1} ${y1}` }

/**
 * A knob (production.md §3 I, FabFilter's conventions): drag up or down, Shift for fine, double-click
 * to type a value, Alt-click to reset. It is a native range input underneath, so arrows, Home, End,
 * Page keys, focus and screen readers work as for any slider.
 */
function Knob(p: SliderProps) {
  const id = useId()
  const def = useRef(p.def ?? p.value)
  const drag = useRef<{ y: number; v: number } | null>(null)
  const [typing, setTyping] = useState<string | null>(null)
  const typeRef = useRef<HTMLInputElement>(null)
  const isTyping = typing !== null
  useEffect(() => { if (isTyping) typeRef.current?.select() }, [isTyping])
  const step = p.step ?? 1
  const clamp = (v: number) => Math.min(p.max, Math.max(p.min, Math.round(v / step) * step))
  const f = p.max > p.min ? (p.value - p.min) / (p.max - p.min) : 0
  const a = A0 + f * (A1 - A0)
  const zero = p.min < 0 && p.max > 0 ? A0 + ((0 - p.min) / (p.max - p.min)) * (A1 - A0) : A0 // bipolar knobs fill from the middle
  const shown = p.format ? p.format(p.value) : String(p.value)
  const commit = () => {
    if (typing !== null) { const v = (p.parse ?? parseNumber)(typing); if (v !== null && Number.isFinite(v)) p.onChange(clamp(v)) }
    setTyping(null)
  }
  return (
    <div className={`field knob ${p.disabled ? 'off' : ''}`}>
      <div className="dial">
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <path d={arc(A0, A1, 15)} className="track" />
          {Math.abs(a - zero) > 0.5 && <path d={a > zero ? arc(zero, a, 15) : arc(a, zero, 15)} className="amount" />}
          <circle cx="20" cy="20" r="10.5" className="cap" />
          <line x1={pt(a, 4)[0]} y1={pt(a, 4)[1]} x2={pt(a, 9.5)[0]} y2={pt(a, 9.5)[1]} className="needle" />
        </svg>
        <input
          id={id} type="range" min={p.min} max={p.max} step={step} value={p.value} disabled={p.disabled}
          aria-valuetext={shown}
          onChange={(e) => p.onChange(Number(e.target.value))}
          onPointerDown={(e) => {
            if (p.disabled) return
            e.preventDefault()
            if (e.altKey) { p.onChange(clamp(def.current)); return }
            e.currentTarget.focus()
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { y: e.clientY, v: p.value }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            const sens = e.shiftKey ? 1200 : 180
            p.onChange(clamp(d.v + ((d.y - e.clientY) * (p.max - p.min)) / sens))
          }}
          onPointerUp={() => { drag.current = null }}
          onPointerCancel={() => { drag.current = null }}
          onDoubleClick={() => !p.disabled && setTyping(shown.replace(/[^\d.\-k]/gi, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') setTyping(shown.replace(/[^\d.\-k]/gi, '')) }}
        />
      </div>
      <label htmlFor={id} className="klab">{p.label}</label>
      {typing === null
        ? <span className="kval">{shown}</span>
        : <input ref={typeRef} className="ktype" aria-label={`${p.label}: type a value`} value={typing} onChange={(e) => setTyping(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setTyping(null) }} />}
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
