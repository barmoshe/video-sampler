export const pct = (v: number) => `${Math.round(v * 100)}%`
export const ms = (v: number) => (v >= 1 ? `${v.toFixed(2)} s` : `${Math.round(v * 1000)} ms`)
export const rgb = (c: [number, number, number]) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`
