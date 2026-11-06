// math §9: the mip-mapped sample. levels[k] = channels low-passed and decimated by 2^k, so a voice
// pitched up reads a level where its step stays at or under 1 (no aliasing). Pure, so it runs in
// a worker at ingest (1.1 s for 30 s of stereo on the spike machine).

function halfband(taps = 95): Float32Array {
  const M = (taps - 1) / 2, fc = 0.225, h = new Float32Array(taps)
  let sum = 0
  for (let i = 0; i < taps; i++) {
    const x = i - M
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x)
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1))
    h[i] = sinc * w
    sum += h[i]
  }
  for (let i = 0; i < taps; i++) h[i] /= sum
  return h
}

export function pyramid(channels: Float32Array[], nLevels = 7): Float32Array[][] {
  const h = halfband(), M = (h.length - 1) / 2
  const levels: Float32Array[][] = [channels]
  for (let k = 1; k < nLevels; k++) {
    const prev = levels[k - 1]
    if (prev[0].length < 64) break
    levels.push(prev.map((x) => {
      const y = new Float32Array(Math.floor(x.length / 2))
      for (let j = 0; j < y.length; j++) {
        let acc = 0
        const c = 2 * j
        const t0 = Math.max(0, M - c), t1 = Math.min(h.length, x.length - c + M)
        for (let t = t0; t < t1; t++) acc += h[t] * x[c + t - M]
        y[j] = acc
      }
      return y
    }))
  }
  return levels
}

export function reversed(channels: Float32Array[]): Float32Array[] {
  return channels.map((c) => Float32Array.from(c).reverse())
}
