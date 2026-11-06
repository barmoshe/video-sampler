// Export loudness (spike test 8 found −30 LUFS with a fixed gain): normalise to a target and catch
// peaks with a lookahead limiter, before the AAC encode.
import { loudness } from './analysis/analyse'

export function normalise(buf: AudioBuffer, targetLufs = -14, ceiling = 0.89): { buffer: AudioBuffer; lufsIn: number; gainDb: number } {
  const ch = [...Array(buf.numberOfChannels)].map((_, c) => Float32Array.from(buf.getChannelData(c)))
  const fs = buf.sampleRate
  const lufsIn = loudness(ch, fs)
  const gainDb = lufsIn > -70 ? Math.min(24, targetLufs - lufsIn) : 0
  const g = Math.pow(10, gainDb / 20)
  for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= g
  limit(ch, fs, ceiling)
  const out = new AudioBuffer({ length: buf.length, numberOfChannels: ch.length, sampleRate: fs })
  ch.forEach((c, i) => out.copyToChannel(c, i))
  return { buffer: out, lufsIn, gainDb }
}

/** Lookahead limiter: the gain reaches its minimum before a peak arrives, then releases over 80 ms. */
function limit(ch: Float32Array[], fs: number, ceiling: number) {
  const n = ch[0].length, look = Math.round(0.005 * fs), rel = 1 - Math.exp(-1 / (0.08 * fs))
  const need = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let p = 0
    for (const c of ch) p = Math.max(p, Math.abs(c[i]))
    need[i] = p > ceiling ? ceiling / p : 1
  }
  // sliding-window minimum over the next `look` samples (monotonic deque)
  const win = new Float32Array(n), dq: number[] = []
  for (let i = n - 1; i >= 0; i--) {
    while (dq.length && need[dq[dq.length - 1]] >= need[i]) dq.pop()
    dq.push(i)
    while (dq[0] > i + look) dq.shift()
    win[i] = need[dq[0]]
  }
  let gain = 1
  for (let i = 0; i < n; i++) {
    gain = win[i] < gain ? win[i] : gain + (Math.min(1, win[i]) - gain) * rel
    for (const c of ch) c[i] *= gain
  }
}
