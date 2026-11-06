// Clip import (design §4 ingest): Mediabunny demuxes and decodes the video once into the GPU frame
// cache (resize first, then upload: spike test 2), while the audio is decoded, pyramided and
// analysed in a worker. Clips are capped at 60 s in v1.
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny'
import { cuts } from './analysis/analyse'
import type { FrameCache } from './gl'
import type { Clip } from './types'

export const MAX_SECONDS = 60

export interface Imported { clip: Clip; fwd: Float32Array[][]; rev: Float32Array[][] }

let seq = 0

export async function importClip(file: Blob, name: string, ctx: BaseAudioContext, cache: FrameCache, onProgress?: (f: number, stage: string) => void): Promise<Imported> {
  const id = `c${Date.now().toString(36)}${(seq++).toString(36)}`
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const vt = await input.getPrimaryVideoTrack()
  if (!vt) throw new Error('That file has no video track.')
  const duration = Math.min(MAX_SECONDS, await input.computeDuration())
  const stats = await vt.computePacketStats(120).catch(() => null)
  const srcFps = Math.min(120, Math.max(1, stats?.averagePacketRate ?? 30))
  const width = vt.displayWidth, height = vt.displayHeight, aspect = width / height

  // audio first (it is fast) so the worker runs while the frames decode
  onProgress?.(0, 'Reading sound')
  const audio = await decodeSound(file, ctx, duration)
  const worker = new Worker(new URL('./pyramid.worker.ts', import.meta.url), { type: 'module' })
  const analysed = new Promise<{ fwd: Float32Array[][]; rev: Float32Array[][]; analysis: { root: number; rootFound: boolean; onsets: number[]; loudness: number } }>((ok, fail) => {
    worker.onmessage = (e) => { ok(e.data); worker.terminate() }
    worker.onerror = (e) => { fail(new Error(e.message)); worker.terminate() }
  })
  worker.postMessage({ id, fs: audio.fs, channels: audio.channels.map((c) => c.slice()) })

  // frames: one pass, two tiers, every frame resized then uploaded and released at once
  const maxLayers = cache.gl.getParameter(cache.gl.MAX_ARRAY_TEXTURE_LAYERS) as number
  const total = Math.max(1, Math.round(duration * srcFps))
  const step = Math.ceil(total / maxLayers)
  const fps = srcFps / step
  const frames = Math.max(1, Math.floor(total / step))
  const cf = cache.allocate(id, frames, fps, aspect)
  const tiers = [cf.S, ...(cf.M ? [cf.M] : [])].map((arr) => {
    const c = new OffscreenCanvas(arr.w, arr.h)
    return { arr, c, g: c.getContext('2d')! }
  })
  const tiny = new OffscreenCanvas(32, 18), tg = tiny.getContext('2d', { willReadFrequently: true })!
  const diff = new Float32Array(frames)
  let prev: Uint8ClampedArray | null = null
  let poster: [number, number, number] = [0.5, 0.5, 0.5]
  const sink = new VideoSampleSink(vt)
  let n = 0
  for await (const sample of sink.samples(0, duration)) {
    const i = Math.floor(sample.timestamp * srcFps + 1e-6)
    if (i % step === 0) {
      const layer = Math.min(frames - 1, Math.floor(i / step))
      for (const t of tiers) { sample.drawWithFit(t.g, { fit: 'fill' }); cache.upload(t.arr, layer, t.c) }
      tg.drawImage(tiers[0].c, 0, 0, 32, 18)
      const px = tg.getImageData(0, 0, 32, 18).data
      if (prev) { let s = 0; for (let k = 0; k < px.length; k += 4) s += Math.abs(px[k] - prev[k]) + Math.abs(px[k + 1] - prev[k + 1]) + Math.abs(px[k + 2] - prev[k + 2]); diff[layer] = s / (px.length * 0.75 * 255) }
      prev = px
      if (layer === cf.poster) poster = dominant(px)
      if (++n % 15 === 0) onProgress?.(Math.min(0.95, layer / frames), 'Reading pictures')
    }
    sample.close()
  }
  cache.gl.finish()
  onProgress?.(0.97, 'Tuning')
  const { fwd, rev, analysis } = await analysed
  const clip: Clip = {
    id, name, duration, fs: audio.fs, channels: fwd[0], fps, frames, width, height, aspect,
    root: analysis.root, rootFound: analysis.rootFound, poster, onsets: analysis.onsets, cuts: cuts(diff, fps), loudness: analysis.loudness,
  }
  onProgress?.(1, 'Ready')
  return { clip, fwd, rev }
}

async function decodeSound(file: Blob, ctx: BaseAudioContext, duration: number): Promise<{ fs: number; channels: Float32Array[] }> {
  const fs = ctx.sampleRate
  const n = Math.max(1, Math.round(duration * fs))
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer())
    const chans = [0, Math.min(1, buf.numberOfChannels - 1)].map((c) => buf.getChannelData(c).slice(0, n))
    return { fs, channels: chans }
  } catch {
    return { fs, channels: [new Float32Array(n), new Float32Array(n)] } // a silent clip still plays its picture
  }
}

/** The frame's most saturated mean colour (for pad colours and the empty Home-grid cells). */
function dominant(px: Uint8ClampedArray): [number, number, number] {
  let r = 0, g = 0, b = 0, w = 0
  for (let k = 0; k < px.length; k += 4) {
    const R = px[k] / 255, G = px[k + 1] / 255, B = px[k + 2] / 255
    const s = Math.max(R, G, B) - Math.min(R, G, B) + 0.05
    r += R * s; g += G * s; b += B * s; w += s
  }
  return [r / w, g / w, b / w]
}
