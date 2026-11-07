export const pct = (v: number) => `${Math.round(v * 100)}%`
export const ms = (v: number) => (v >= 1 ? `${v.toFixed(2)} s` : `${Math.round(v * 1000)} ms`)
export const rgb = (c: [number, number, number]) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`
export const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`)
/** Cutoff knobs turn on a log scale: 0..1000 maps 20 Hz..20 kHz. */
export const toLog = (hzv: number) => Math.round((Math.log(hzv / 20) / Math.log(1000)) * 1000)
export const fromLog = (x: number) => 20 * Math.pow(1000, x / 1000)
export const parseHz = (s: string) => { const m = /^\s*(\d*\.?\d+)\s*(k)?/i.exec(s); return m ? toLog(Math.max(20, Math.min(20000, Number(m[1]) * (m[2] ? 1000 : 1)))) : null }
export const st = (v: number) => `${v > 0 ? '+' : ''}${v} st`
export const db = (v: number) => `${v > 0 ? '+' : ''}${v} dB`
export const panText = (v: number) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)
