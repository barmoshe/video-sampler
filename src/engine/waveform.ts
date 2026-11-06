// Waveform peaks for the sample editor: min and max of each column, from level 0 of the clip.

/** n columns of [min, max] over the samples in [from, to) seconds. */
export function peaks(x: Float32Array, fs: number, n: number, from = 0, to = x.length / fs): Float32Array {
  const out = new Float32Array(n * 2)
  const a = Math.max(0, Math.floor(from * fs)), b = Math.min(x.length, Math.ceil(to * fs))
  const per = Math.max(1, (b - a) / n)
  for (let c = 0; c < n; c++) {
    const i0 = a + Math.floor(c * per), i1 = Math.min(b, a + Math.floor((c + 1) * per))
    let lo = 0, hi = 0
    for (let i = i0; i < i1; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v }
    out[2 * c] = lo
    out[2 * c + 1] = hi
  }
  return out
}
