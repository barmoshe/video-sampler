// The effects bus (production.md §3 D, §5.2): two returns fed by per-voice sends from the worklet
// (a tempo-synced ping-pong delay and a convolution reverb), then a glue compressor, a limiter and
// a meter. Plain Web Audio nodes, built the same way in the live AudioContext and in the export's
// OfflineAudioContext, so the export sounds like what was played. The reverb's impulse response is
// decaying stereo noise from a seeded generator (Tone.Reverb's method, our code), the same every time.

export interface FxSettings {
  delay: { beats: number; feedback: number; tone: number; level: number } // beats of the project tempo; tone = low-pass Hz in the loop
  reverb: { decay: number; tone: number; level: number } // seconds to −60 dB; tone = low-pass Hz of the tail
  glue: number // 0..1, how hard the bus compressor works
}
export const defaultFx = (): FxSettings => ({
  delay: { beats: 0.75, feedback: 0.38, tone: 4500, level: 0.8 },
  reverb: { decay: 2.2, tone: 7000, level: 0.8 },
  glue: 0.35,
})

/** Seconds of delay at a tempo. */
export const delaySeconds = (fx: FxSettings, bpm: number) => Math.min(2, (fx.delay.beats * 60) / Math.max(30, bpm))

/** A reproducible stereo impulse response: noise under an exponential decay, darkened by a one-pole low-pass. */
export function impulse(ctx: BaseAudioContext, decay: number, tone: number, seed = 7): AudioBuffer {
  const fs = ctx.sampleRate, len = Math.max(1, Math.round(fs * Math.min(8, decay * 1.1 + 0.05)))
  const buf = ctx.createBuffer(2, len, fs), pre = Math.round(fs * 0.012)
  let s = seed >>> 0
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1 }
  const k = Math.exp((-2 * Math.PI * tone) / fs), tau = decay / Math.log(1000)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let y = 0
    for (let i = pre; i < len; i++) {
      y = (1 - k) * rnd() + k * y
      const t = (i - pre) / fs
      d[i] = y * Math.exp(-t / tau) * Math.min(1, t / 0.004)
    }
  }
  // unit energy, so the decay length changes the tail, not the level
  let e = 0
  for (let c = 0; c < 2; c++) for (const v of buf.getChannelData(c)) e += v * v
  const g = 1 / Math.sqrt(e / 2 || 1)
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] *= g }
  return buf
}

/** The bus: dry + delay return + reverb return → glue → limiter → meter → out. */
export class FxBus {
  readonly input: GainNode // dry (the voices' main output)
  readonly delayIn: GainNode
  readonly reverbIn: GainNode
  readonly output: AnalyserNode
  private dL: DelayNode; private dR: DelayNode
  private fbL: GainNode; private fbR: GainNode
  private toneL: BiquadFilterNode; private toneR: BiquadFilterNode
  private delayRet: GainNode
  private conv: ConvolverNode
  private reverbRet: GainNode
  private glue: DynamicsCompressorNode
  private ir = ''

  constructor(ctx: BaseAudioContext) {
    this.input = new GainNode(ctx, { gain: 0.5 }) // design §5: a −6 dB poly trim
    this.delayIn = new GainNode(ctx, { gain: 0.5 })
    this.reverbIn = new GainNode(ctx, { gain: 0.5 })
    const bus = new GainNode(ctx)
    // ping-pong: left feeds right, right feeds left, each pass darker
    const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 }), merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 })
    this.dL = new DelayNode(ctx, { maxDelayTime: 2.5 }); this.dR = new DelayNode(ctx, { maxDelayTime: 2.5 })
    this.fbL = new GainNode(ctx); this.fbR = new GainNode(ctx)
    this.toneL = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.5 }); this.toneR = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.5 })
    this.delayRet = new GainNode(ctx)
    this.delayIn.connect(split)
    split.connect(this.dL, 0); split.connect(this.dR, 1)
    this.dL.connect(this.toneL).connect(this.fbL).connect(this.dR)
    this.dR.connect(this.toneR).connect(this.fbR).connect(this.dL)
    this.toneL.connect(merge, 0, 0); this.toneR.connect(merge, 0, 1)
    merge.connect(this.delayRet).connect(bus)
    this.conv = new ConvolverNode(ctx, { disableNormalization: true })
    this.reverbRet = new GainNode(ctx)
    this.reverbIn.connect(this.conv).connect(this.reverbRet).connect(bus)
    this.input.connect(bus)
    this.glue = new DynamicsCompressorNode(ctx, { knee: 6, attack: 0.01, release: 0.2 })
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -2, knee: 0, ratio: 20, attack: 0.002, release: 0.12 })
    this.output = new AnalyserNode(ctx, { fftSize: 2048 })
    bus.connect(this.glue).connect(limiter).connect(this.output)
  }

  /** Apply settings at the project tempo (the delay follows it). */
  set(fx: FxSettings, bpm: number, ctx: BaseAudioContext) {
    const d = delaySeconds(fx, bpm), now = ctx.currentTime
    this.dL.delayTime.setValueAtTime(d, now); this.dR.delayTime.setValueAtTime(d, now)
    const fb = Math.max(0, Math.min(0.92, fx.delay.feedback))
    this.fbL.gain.setValueAtTime(fb, now); this.fbR.gain.setValueAtTime(fb, now)
    this.toneL.frequency.setValueAtTime(fx.delay.tone, now); this.toneR.frequency.setValueAtTime(fx.delay.tone, now)
    this.delayRet.gain.setValueAtTime(fx.delay.level, now)
    this.reverbRet.gain.setValueAtTime(fx.reverb.level * 0.6, now)
    const key = `${fx.reverb.decay.toFixed(2)}:${Math.round(fx.reverb.tone)}`
    if (key !== this.ir) { this.ir = key; this.conv.buffer = impulse(ctx, fx.reverb.decay, fx.reverb.tone) }
    const g = Math.max(0, Math.min(1, fx.glue))
    this.glue.threshold.setValueAtTime(-6 - 18 * g, now)
    this.glue.ratio.setValueAtTime(1 + 3 * g, now)
  }

  /** Momentary level in dBFS (RMS over the analyser's window), for the meter. */
  level(buf: Float32Array<ArrayBuffer>): number {
    this.output.getFloatTimeDomainData(buf)
    let e = 0
    for (const v of buf) e += v * v
    return 10 * Math.log10(e / buf.length + 1e-12)
  }
}
