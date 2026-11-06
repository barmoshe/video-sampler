// The audio side: one AudioContext (or OfflineAudioContext for export), the voice-engine worklet,
// and the master chain (poly trim → safety limiter). Clips are sent to the worklet as pyramids.
import workletUrl from './worklet/voice-engine.ts?worker&url'
import type { EngineEvent } from './worklet/voice-engine'

export class AudioEngine {
  readonly ctx: BaseAudioContext
  readonly node: AudioWorkletNode
  readonly trim: GainNode
  readonly limiter: DynamicsCompressorNode
  readonly analyser: AnalyserNode
  private acks = new Map<number, () => void>()
  private nextAck = 1
  private loaded = new Set<string>()

  private constructor(ctx: BaseAudioContext, node: AudioWorkletNode) {
    this.ctx = ctx
    this.node = node
    // design §5: unity voices, a −6 dB poly trim, a master limiter as a safety net (spike: 128 voices peak at +24 dB)
    this.trim = new GainNode(ctx, { gain: 0.5 })
    this.limiter = new DynamicsCompressorNode(ctx, { threshold: -2, knee: 0, ratio: 20, attack: 0.002, release: 0.12 })
    this.analyser = new AnalyserNode(ctx, { fftSize: 1024 })
    node.connect(this.trim).connect(this.limiter).connect(this.analyser).connect(ctx.destination)
    node.port.onmessage = (e) => {
      if (e.data?.type === 'ack') { this.acks.get(e.data.ack)?.(); this.acks.delete(e.data.ack) }
    }
  }

  static async create(ctx: BaseAudioContext): Promise<AudioEngine> {
    await ctx.audioWorklet.addModule(workletUrl)
    const node = new AudioWorkletNode(ctx, 'voice-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
    return new AudioEngine(ctx, node)
  }

  private send(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<void> {
    const ack = this.nextAck++
    return new Promise((ok) => { this.acks.set(ack, ok); this.node.port.postMessage({ ...msg, ack }, transfer) })
  }

  async loadClip(id: string, fs: number, fwd: Float32Array[][], rev: Float32Array[][]): Promise<void> {
    // copies, so the main thread keeps its own level 0 for analysis and export
    await this.send({ type: 'clip', id, fs, levels: fwd.map((l) => l.map((c) => c.slice())) })
    await this.send({ type: 'clip', id: id + ':rev', fs, levels: rev.map((l) => l.map((c) => c.slice())) })
    this.loaded.add(id)
  }

  has(id: string) { return this.loaded.has(id) }

  unloadClip(id: string) {
    this.node.port.postMessage({ type: 'unclip', id })
    this.node.port.postMessage({ type: 'unclip', id: id + ':rev' })
    this.loaded.delete(id)
  }

  events(evs: EngineEvent[]): Promise<void> { return this.send({ type: 'events', events: evs }) }
  panic() { this.node.port.postMessage({ type: 'panic' }) }

  get sampleRate() { return this.ctx.sampleRate }
  frameOf(t: number) { return Math.round(t * this.ctx.sampleRate) }
}

/**
 * math §10 with the spike's guard: getOutputTimestamp() reports 0/0 for about the first 0.6 s of
 * a context, and a naive mapping then schedules notes minutes ahead (the first hand-test page was
 * silent). Until the clock reports, play now; after, use the event's own time + L, clamped to at
 * most 250 ms ahead.
 */
export function scheduleTime(ctx: AudioContext, eventTimeStamp: number, latencyMs: number): number {
  const ts = ctx.getOutputTimestamp()
  let t = ctx.currentTime
  if ((ts.performanceTime ?? 0) > 0) t = (ts.contextTime ?? 0) + (eventTimeStamp + latencyMs - (ts.performanceTime ?? 0)) / 1000
  return Math.min(Math.max(t, ctx.currentTime + 0.003), ctx.currentTime + 0.25)
}

/** The audio-context time audible at a performance.now() instant (for the picture). */
export function audibleAt(ctx: AudioContext, perfNow: number): number {
  const ts = ctx.getOutputTimestamp()
  if ((ts.performanceTime ?? 0) > 0) return (ts.contextTime ?? 0) + (perfNow - (ts.performanceTime ?? 0)) / 1000
  return ctx.currentTime - (ctx.outputLatency || 0) - ctx.baseLatency
}
