import { useEffect, useRef } from 'react'
import { app } from '../engine/app'

/** The mix's level: momentary RMS in dBFS, a bar from −48 to 0 dB, orange above −3. */
export function Meter() {
  const bar = useRef<HTMLSpanElement>(null)
  const num = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const buf = new Float32Array(2048)
    const id = window.setInterval(() => {
      const db = app.engine ? app.engine.fx.level(buf) : -120
      const f = Math.max(0, Math.min(1, (db + 48) / 48))
      if (bar.current) { bar.current.style.width = `${f * 100}%`; bar.current.style.background = db > -3 ? 'var(--orange)' : 'var(--ink-2)' }
      if (num.current) num.current.textContent = db > -60 ? `${db.toFixed(0)} dB` : '−∞'
    }, 100)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="meter" title="The mix's level (momentary RMS)">
      <span className="track"><span ref={bar} /></span>
      <span ref={num} className="num">−∞</span>
    </span>
  )
}
