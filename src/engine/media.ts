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
  const rotation = (((vt.rotation ?? 0) % 360) + 360) % 360 as 0 | 90 | 180 | 270

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
  const sink = new VideoSampleSink(vt)
  // Phone videos are stored sideways with a rotation flag. Frames are cached as stored and the
  // shader rotates them, unless this browser's createImageBitmap already applies the flag.
  let stored: 0 | 90 | 180 | 270 = rotation
  if (rotation % 180 !== 0) {
    const s0 = await sink.getSample(0)
    if (s0) {
      const f = s0.toVideoFrame(), bm = await createImageBitmap(f)
      if (bm.width === width && bm.height === height) stored = 0
      bm.close(); f.close(); s0.close()
    }
  }
  const storedAspect = stored % 180 ? height / width : width / height
  const cf = cache.allocate(id, frames, fps, storedAspect, stored)
  const arrs = [cf.S, ...(cf.M ? [cf.M] : [])]
  // spike test 1's path: resize with createImageBitmap, several frames in flight, upload, close at once
  const pending = new Set<Promise<void>>()
  let n = 0
  const tm = { wait: 0, bitmap: 0, upload: 0 }
  let tw = performance.now()
  for await (const sample of sink.samples(0, duration)) {
    tm.wait += performance.now() - tw
    const i = Math.floor(sample.timestamp * srcFps + 1e-6)
    if (i % step !== 0) { sample.close(); tw = performance.now(); continue }
    const layer = Math.min(frames - 1, Math.floor(i / step))
    const frame = sample.toVideoFrame()
    sample.close()
    const job = (async () => {
      const t0 = performance.now()
      const bms = await Promise.all(arrs.map((a) => createImageBitmap(frame, { resizeWidth: a.w, resizeHeight: a.h, resizeQuality: 'medium' })))
      frame.close()
      const t1 = performance.now()
      bms.forEach((bm, k) => { cache.upload(arrs[k], layer, bm); bm.close() })
      tm.bitmap += t1 - t0; tm.upload += performance.now() - t1
    })()
    pending.add(job)
    void job.finally(() => pending.delete(job))
    if (pending.size >= 6) await Promise.race(pending)
    if (++n % 15 === 0) onProgress?.(Math.min(0.95, layer / frames), 'Reading pictures')
    tw = performance.now()
  }
  await Promise.all(pending)
  console.info(`[ingest timing] frames ${n}: decoder wait ${tm.wait.toFixed(0)} ms, bitmaps ${tm.bitmap.toFixed(0)} ms, uploads ${tm.upload.toFixed(0)} ms`)
  // scene cuts and the poster colour from GPU thumbnails, read back in batches
  const thumbs = cache.thumbnails(cf.S)
  const T = 32 * 18 * 4
  const diff = new Float32Array(frames)
  for (let l = 1; l < frames; l++) {
    let s = 0
    for (let k = 0; k < T; k += 4) s += Math.abs(thumbs[l * T + k] - thumbs[(l - 1) * T + k]) + Math.abs(thumbs[l * T + k + 1] - thumbs[(l - 1) * T + k + 1]) + Math.abs(thumbs[l * T + k + 2] - thumbs[(l - 1) * T + k + 2])
    diff[l] = s / (T * 0.75 * 255)
  }
  const poster = dominant(thumbs.subarray(cf.poster * T, (cf.poster + 1) * T))
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
function dominant(px: Uint8Array): [number, number, number] {
  let r = 0, g = 0, b = 0, w = 0
  for (let k = 0; k < px.length; k += 4) {
    const R = px[k] / 255, G = px[k + 1] / 255, B = px[k + 2] / 255
    const s = Math.max(R, G, B) - Math.min(R, G, B) + 0.05
    r += R * s; g += G * s; b += B * s; w += s
  }
  return [r / w, g / w, b / w]
}
