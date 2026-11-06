// Ingest worker: a clip's pyramid (and its reversed twin) plus its audio analysis, off the main
// thread (spike: 1.1 s of pyramid per 30 s of stereo; onsets cost about as much again).
import { autoRoot, loudness, onsets } from './analysis/analyse'
import { mono } from './analysis/dsp'
import { pyramid, reversed } from './pyramid'

self.onmessage = (e: MessageEvent<{ id: string; fs: number; channels: Float32Array[] }>) => {
  const { id, fs, channels } = e.data
  const m = mono(channels)
  const root = autoRoot(m, fs)
  const analysis = { root: root.midi, rootFound: root.found, onsets: onsets(m, fs), loudness: loudness(channels, fs) }
  const fwd = pyramid(channels)
  const rev = pyramid(reversed(channels))
  const transfer = [...fwd.flat(), ...rev.flat()].map((a) => a.buffer as ArrayBuffer)
  ;(self as unknown as Worker).postMessage({ id, fwd, rev, analysis }, transfer)
}
