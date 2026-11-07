// Offline export (design §9, spike test 8): replay a take through the same instruments into an
// OfflineAudioContext running the same worklet, draw every output frame from the same voice book
// with the same stage, and mux to MP4 with Mediabunny. The spike's two QC findings are fixed here:
// frames are tagged BT.709, and the mix is normalised to −14 LUFS behind a lookahead limiter.
import { AudioBufferSource, BufferTarget, canEncodeAudio, Mp4OutputFormat, Output, VideoSample, VideoSampleSource } from 'mediabunny'
import { AudioEngine } from './audio'
import { normalise } from './loudness-out'
import { Performer, type InstrumentState, type TrackMix } from './performer'
import { LOOKS, type Stage, type DrawOptions, type Look } from './stage'
import { LayoutEngine } from './layout'
import type { Take } from './take'
import type { Clip, LayoutMode, StageAspect } from './types'
import type { EngineEvent } from './worklet/voice-engine'
import { delaySeconds, type FxSettings } from './fx'

export interface ExportOptions { aspect: StageAspect; layout: LayoutMode; height: 720 | 1080; fps: 30 | 60; followSections?: boolean }

export const SIZES: Record<StageAspect, [number, number]> = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1] }

export function exportSize(aspect: StageAspect, short: number): [number, number] {
  const [a, b] = SIZES[aspect]
  const scale = short / Math.min(a, b)
  return [Math.round((a * scale) / 2) * 2, Math.round((b * scale) / 2) * 2]
}

interface Deps {
  state: InstrumentState
  clips: Map<string, Clip>
  levels: Map<string, { fwd: Float32Array[][]; rev: Float32Array[][] }>
  stage: Stage
  homeCells?: DrawOptions['homeCells']
  homeBase?: number
  fit: boolean
  fx: FxSettings
  bpm: number
  look?: Look
  /** A song (ADR 0773): one performer per track over one voice book, and the stage laid out by track. */
  tracks?: { id: string; state: InstrumentState; mix: TrackMix; mode: LayoutMode }[]
  trackMode?: LayoutMode
}

const LEAD = 0.1, TAIL = 1.5, FS = 48000
const BT709: VideoColorSpaceInit = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false }

export async function exportTake(take: Take, d: Deps, o: ExportOptions, progress: (p: number, stage: string) => void): Promise<Blob> {
  const seconds = LEAD + take.duration + Math.max(TAIL, d.fx.reverb.decay * 0.8, 4 * delaySeconds(d.fx, d.bpm)) // the returns' tails
  // ---- sound
  const octx = new OfflineAudioContext(2, Math.ceil(seconds * FS), FS)
  const engine = await AudioEngine.create(octx)
  engine.setFx(d.fx, d.bpm)
  const used = new Set<string>()
  const all: EngineEvent[] = []
  const sink = { send: (evs: EngineEvent[]) => { all.push(...evs) }, frameOf: (t: number) => Math.round(t * FS) }
  const performer = new Performer(structuredClone(d.state), d.clips, sink)
  const byTrack = new Map((d.tracks ?? []).map((tr) => [tr.id, new Performer(structuredClone(tr.state), d.clips, sink, { book: performer.book, track: tr.id, mix: () => tr.mix })]))
  for (const { t, ev } of take.events) {
    const tr = (ev.type === 'on' || ev.type === 'off') && ev.track ? byTrack.get(ev.track) : undefined
    ;(tr ?? performer).play(ev, LEAD + t)
  }
  for (const v of performer.book.voices) used.add(v.clipId)
  for (const id of used) {
    const lv = d.levels.get(id), clip = d.clips.get(id)
    if (lv && clip) await engine.loadClip(id, clip.fs, lv.fwd, lv.rev)
  }
  await engine.events(all)
  progress(0.02, 'Sound')
  const rendered = await octx.startRendering()
  const { buffer } = normalise(rendered)
  progress(0.1, 'Picture')

  // ---- picture, on the live stage's canvas and GPU cache (one GL context holds the frames)
  const [W, H] = exportSize(o.aspect, o.height)
  const canvas = d.stage.canvas
  const keep = { w: canvas.width, h: canvas.height, layout: d.stage.layout, inner: d.stage.inner }
  d.stage.inner = new Map()
  d.stage.resize(W, H)
  d.stage.layout = new LayoutEngine()
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const video = new VideoSampleSource({ codec: 'avc', bitrate: W * H >= 1920 * 1080 ? 12e6 : 8e6, keyFrameInterval: 2 })
  const audio = new AudioBufferSource({ codec: (await canEncodeAudio('aac')) ? 'aac' : 'opus', bitrate: 192e3 })
  output.addVideoTrack(video, { frameRate: o.fps })
  output.addAudioTrack(audio)
  await output.start()
  try {
    await audio.add(buffer)
    const frames = Math.ceil(seconds * o.fps)
    const voices = performer.book.voices
    const gl = d.stage.gl
    // A canvas-backed frame carries the canvas's sRGB tag whatever we ask (the spike's QC FAIL), so
    // read the pixels back and build the frame from them with an explicit BT.709 colour space.
    const raw = new Uint8Array(W * H * 4), rows = new Uint8Array(W * H * 4), stride = W * 4
    // sections' layout cues (ADR 0771), followed unless the export picks one layout for all
    const cues = take.events.flatMap((e) => (e.ev.type === 'layout' ? [{ t: LEAD + e.t, mode: e.ev.mode, section: e.ev.section }] : []))
    const cueAt = (t: number) => { let c: (typeof cues)[number] | undefined; for (const x of cues) if (x.t <= t) c = x; return c }
    const modeAt = (t: number) => (o.followSections === false ? o.layout : cueAt(t)?.mode ?? o.layout)
    // a song's picture track: its look cues change the tiles' look over time
    const looks = take.events.flatMap((e) => (e.ev.type === 'look' ? [{ t: LEAD + e.t, look: LOOKS.find((l) => l.id === (e.ev as { look: string }).look)?.look }] : []))
    const lookAt = (t: number) => { let l = d.look; for (const x of looks) if (x.t <= t && x.look) l = x.look; return l }
    const tracks = d.tracks?.map((tr, i) => ({ id: tr.id, order: i, mode: tr.mode }))
    for (let k = 0; k < frames; k++) {
      const t = k / o.fps
      d.stage.drawAt(t, t, voices, d.clips, { echo: { time: delaySeconds(d.fx, d.bpm), feedback: d.fx.delay.feedback, level: d.fx.delay.level, decay: d.fx.reverb.decay, reverb: d.fx.reverb.level }, section: cueAt(t)?.section, mode: tracks ? o.layout : modeAt(t), homeCells: d.homeCells, homeBase: d.homeBase, fit: d.fit, maxTaps: 16, displayFps: o.fps, hold: take.hold, look: lookAt(t), tracks, trackMode: tracks ? modeAt(t) : undefined, holdTracks: tracks ? seconds : undefined })
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, raw)
      for (let y = 0; y < H; y++) rows.set(raw.subarray((H - 1 - y) * stride, (H - y) * stride), y * stride) // GL reads bottom-up
      const sample = new VideoSample(rows, { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: t, duration: 1 / o.fps, colorSpace: BT709 })
      await video.add(sample)
      sample.close()
      if (k % 15 === 0) progress(0.1 + (0.88 * k) / frames, 'Picture')
    }
    await output.finalize()
  } finally {
    d.stage.resize(keep.w, keep.h)
    d.stage.layout = keep.layout
    d.stage.inner = keep.inner
  }
  progress(1, 'Done')
  return new Blob([target.buffer!], { type: 'video/mp4' })
}
