// The controller: owns the audio context, engine, performer and stage; React reads its store.
import { AudioEngine, audibleAt, scheduleTime } from './audio'
import {
  defaultClipParams, defaultLayersParams, defaultPadsParams, newLayer, newPad, PAD_BASE,
  type ClipParams, type LayerChain, type LayersParams, type PadChain, type PadsParams,
} from './instruments'
import { attachKeyboard, connectMidi, MidiReceiver, type InputHandlers } from './input'
import { importClip } from './media'
import { Performer, type InstrumentState, type PlayEvent } from './performer'
import { Stage } from './stage'
import { createStore } from './store'
import { midiToTake, takeDuration, takeToMidi, type Take, type TakeEvent } from './take'
import type { Clip, InstrumentKind, LayoutMode, StageAspect } from './types'
import { exportTake, type ExportOptions } from './export'

export interface AppState {
  clips: Clip[]
  importing: { name: string; progress: number; stage: string } | null
  kind: InstrumentKind
  clip: ClipParams
  pads: PadsParams
  layers: LayersParams
  bendRange: number
  layouts: Record<InstrumentKind, LayoutMode>
  aspect: StageAspect
  fit: boolean
  octave: number
  velocity: number
  active: number[]
  recording: boolean
  take: Take | null
  playing: boolean
  midiDevices: string[] | null
  bpm: number | null
  pictureOffsetMs: number
  latencyMode: 'tight' | 'sync'
  exporting: { progress: number; stage: string } | null
  message: string | null
  voices: number
  audioOn: boolean
}

const initial = (): AppState => ({
  clips: [], importing: null, kind: 'clip',
  clip: defaultClipParams(), pads: defaultPadsParams(), layers: defaultLayersParams(), bendRange: 2,
  layouts: { clip: 'gallery', pads: 'home', layers: 'gallery' }, aspect: '16:9', fit: false,
  octave: 0, velocity: 100, active: [], recording: false, take: null, playing: false,
  midiDevices: null, bpm: null, pictureOffsetMs: 50, latencyMode: 'tight', exporting: null, message: null, voices: 0, audioOn: false,
})

export class App {
  store = createStore<AppState>(initial())
  ctx = new AudioContext({ latencyHint: 'interactive' })
  engine: AudioEngine | null = null
  performer: Performer | null = null
  stage: Stage | null = null
  clips = new Map<string, Clip>()
  levels = new Map<string, { fwd: Float32Array[][]; rev: Float32Array[][] }>()
  private rec: { start: number; events: TakeEvent[] } | null = null
  private replaying = false
  private playTimer = 0
  private ready: Promise<void>
  private raf = 0

  constructor() {
    this.ready = this.boot()
    const wake = () => { if (this.ctx.state !== 'running') this.ctx.resume().then(() => this.store.set({ audioOn: true })) }
    addEventListener('pointerdown', wake, { capture: true })
    addEventListener('keydown', wake, { capture: true })
    this.store.subscribe(() => this.syncPerformer())
  }

  private async boot() {
    this.engine = await AudioEngine.create(this.ctx)
    this.performer = new Performer(this.instrumentState(), this.clips, {
      send: (evs) => { void this.engine!.events(evs) },
      frameOf: (t) => Math.round(t * this.ctx.sampleRate),
    })
    this.performer.onPlay = (ev, t) => { if (this.rec && !this.replaying) this.rec.events.push({ t: t - this.rec.start, ev }) }
  }

  private instrumentState(): InstrumentState {
    const s = this.store.get()
    return { kind: s.kind, clip: s.clip, pads: s.pads, layers: s.layers, bendRange: s.bendRange }
  }
  private syncPerformer() { if (this.performer) this.performer.state = this.instrumentState() }

  // ---------- stage ------------------------------------------------------------------------------
  attachStage(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas)
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop)
      this.drawLive(now)
    }
    this.raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(this.raf)
  }

  private lastCount = 0
  private drawLive(now: number) {
    const s = this.store.get()
    if (!this.stage || !this.performer || s.exporting) return
    // math §2 with the hand films' calibration: draw for the audio audible when this frame reaches
    // the eye, one frame plus the measured picture offset ahead
    const t = audibleAt(this.ctx, now) + 1 / 60 + s.pictureOffsetMs / 1000
    const n = this.stage.drawAt(t, now / 1000, this.performer.book.voices, this.clips, {
      mode: s.layouts[s.kind], fit: s.fit, homeCells: s.kind === 'pads' ? this.homeCells() : undefined, homeBase: this.bankBase(),
    })
    if (n !== this.lastCount) { this.lastCount = n; this.store.set({ voices: n }) }
    if (Math.random() < 0.02) this.performer.book.prune(this.ctx.currentTime)
  }

  bankBase() { return PAD_BASE + this.store.get().pads.bank * 16 }
  homeCells() {
    const base = this.bankBase(), chains = this.store.get().pads.chains
    return Array.from({ length: 16 }, (_, i) => ({ key: `p:${base + i}`, order: i, clipId: chains.find((c) => c.note === base + i)?.clipId ?? null }))
  }

  // ---------- playing ----------------------------------------------------------------------------
  latencyMs() {
    const tight = Math.ceil(((this.ctx.outputLatency || 0) + this.ctx.baseLatency) * 1000 + 5)
    return this.store.get().latencyMode === 'sync' ? tight + this.store.get().pictureOffsetMs : tight
  }

  play(ev: PlayEvent, timeStamp = performance.now()) {
    if (!this.performer) return
    if (this.ctx.state !== 'running') void this.ctx.resume()
    this.performer.play(ev, scheduleTime(this.ctx, timeStamp, this.latencyMs()))
  }

  handlers: InputHandlers = {
    noteOn: (note, vel, ts) => { this.play({ type: 'on', note, vel }, ts); this.store.set((s) => ({ active: [...s.active.filter((n) => n !== note), note] })) },
    noteOff: (note, ts) => { this.play({ type: 'off', note }, ts); this.store.set((s) => ({ active: s.active.filter((n) => n !== note) })) },
    sustain: (down, ts) => this.play({ type: 'sustain', down }, ts),
    bend: (value, ts) => this.play({ type: 'bend', value }, ts),
    modWheel: (value, ts) => this.setMacro(0, value, ts),
    bendRange: (st) => this.store.set({ bendRange: st }),
    panic: () => this.panic(),
    program: (n) => this.store.set((s) => ({ pads: { ...s.pads, bank: n % 8 } })),
    transport: (k) => { if (k === 'start' && !this.rec) this.toggleRecord(); if (k === 'stop' && this.rec) this.toggleRecord() },
    clockBpm: (bpm) => { if (bpm !== this.store.get().bpm) this.store.set({ bpm }) },
  }

  attachKeyboard() {
    return attachKeyboard(this.handlers, () => {
      const s = this.store.get()
      return {
        mode: s.kind === 'pads' ? 'pads' : 'notes',
        baseNote: () => (s.kind === 'pads' ? this.bankBase() : 60 + 12 * s.octave),
        velocity: () => s.velocity,
        octave: (d) => this.store.set((x) => ({ octave: Math.max(-5, Math.min(4, x.octave + d)) })),
        velocityStep: (d) => this.store.set((x) => ({ velocity: Math.max(1, Math.min(127, x.velocity + d)) })),
        record: () => this.toggleRecord(),
      }
    })
  }

  async connectMidi() {
    try { await connectMidi(new MidiReceiver(this.handlers), (names) => this.store.set({ midiDevices: names })) }
    catch (e) { this.say((e as Error).message) }
  }

  setMacro(index: number, value: number, ts = performance.now()) {
    this.store.set((s) => ({ layers: { ...s.layers, macros: s.layers.macros.map((m, i) => (i === index ? { ...m, value } : m)) } }))
    this.play({ type: 'macro', index, value }, ts)
  }

  panic() { this.performer?.panic(this.ctx.currentTime); this.store.set({ active: [] }) }

  // ---------- clips ------------------------------------------------------------------------------
  async importFiles(files: File[], target?: { pad?: number; layer?: string }) {
    await this.ready
    for (const f of files) {
      if (/\.midi?$/i.test(f.name) || f.type === 'audio/midi') { await this.loadMidi(f); continue }
      if (!this.stage) return
      this.store.set({ importing: { name: f.name, progress: 0, stage: 'Opening' } })
      try {
        const { clip, fwd, rev } = await importClip(f, f.name.replace(/\.[^.]+$/, ''), this.ctx, this.stage.cache, (p, stage) => this.store.set({ importing: { name: f.name, progress: p, stage } }))
        this.clips.set(clip.id, clip)
        this.levels.set(clip.id, { fwd, rev })
        await this.engine!.loadClip(clip.id, clip.fs, fwd, rev)
        this.store.set((s) => ({ clips: [...s.clips, clip] }))
        this.assign(clip, target)
      } catch (e) {
        this.say(`Could not read ${f.name}: ${(e as Error).message}`)
      } finally {
        this.store.set({ importing: null })
      }
    }
  }

  /** A clip made in the browser for a first visit (no video needed). */
  async loadDemo() {
    this.store.set({ importing: { name: 'Demo voice', progress: 0, stage: 'Making a demo clip' } })
    try {
      const { makeDemoClip } = await import('./demo')
      const file = await makeDemoClip((p) => this.store.set({ importing: { name: 'Demo voice', progress: p * 0.5, stage: 'Making a demo clip' } }))
      await this.importFiles([file])
    } catch (e) {
      this.store.set({ importing: null })
      this.say(`Could not make the demo clip: ${(e as Error).message}`)
    }
  }

  /** A new clip goes where the player is working: the Clip, a pad, or a new layer. */
  private assign(clip: Clip, target?: { pad?: number; layer?: string }) {
    const s = this.store.get()
    const trim = Math.max(-12, Math.min(12, -16 - clip.loudness)) // math §13: pads levelled to −16 LUFS
    if (s.kind === 'pads' || target?.pad !== undefined) {
      const base = this.bankBase()
      const note = target?.pad ?? [...Array(16).keys()].map((i) => base + i).find((n) => !s.pads.chains.some((c) => c.note === n && c.clipId)) ?? s.pads.selected
      const chains = s.pads.chains.filter((c) => c.note !== note)
      this.store.set({ pads: { ...s.pads, chains: [...chains, { ...newPad(note, clip.id), trim }], selected: note } })
    } else if (s.kind === 'layers' || target?.layer) {
      if (target?.layer) this.setLayer(target.layer, { clipId: clip.id })
      else this.store.set({ layers: { ...s.layers, chains: [...s.layers.chains, newLayer(clip.id)] } })
    } else {
      this.store.set({ clip: { ...s.clip, clipId: clip.id } })
    }
  }

  removeClip(id: string) {
    this.stage?.cache.free(id)
    this.engine?.unloadClip(id)
    this.clips.delete(id)
    this.levels.delete(id)
    this.store.set((s) => ({
      clips: s.clips.filter((c) => c.id !== id),
      clip: s.clip.clipId === id ? { ...s.clip, clipId: null } : s.clip,
      pads: { ...s.pads, chains: s.pads.chains.filter((c) => c.clipId !== id) },
      layers: { ...s.layers, chains: s.layers.chains.map((c) => (c.clipId === id ? { ...c, clipId: null } : c)) },
    }))
  }

  // ---------- parameters -------------------------------------------------------------------------
  setKind(kind: InstrumentKind) { this.panic(); this.store.set({ kind }) }
  setClip(p: Partial<ClipParams>) { this.store.set((s) => ({ clip: { ...s.clip, ...p } })) }
  setPads(p: Partial<PadsParams>) { this.store.set((s) => ({ pads: { ...s.pads, ...p } })) }
  setPad(note: number, p: Partial<PadChain>) {
    this.store.set((s) => {
      const has = s.pads.chains.some((c) => c.note === note)
      const chains = has ? s.pads.chains.map((c) => (c.note === note ? { ...c, ...p } : c)) : [...s.pads.chains, { ...newPad(note), ...p }]
      return { pads: { ...s.pads, chains } }
    })
  }
  setLayers(p: Partial<LayersParams>) { this.store.set((s) => ({ layers: { ...s.layers, ...p } })) }
  setLayer(id: string, p: Partial<LayerChain>) { this.store.set((s) => ({ layers: { ...s.layers, chains: s.layers.chains.map((c) => (c.id === id ? { ...c, ...p } : c)) } })) }
  addLayer() { this.store.set((s) => ({ layers: { ...s.layers, chains: [...s.layers.chains, newLayer(s.clips[0]?.id ?? null)] } })) }
  removeLayer(id: string) { this.store.set((s) => ({ layers: { ...s.layers, chains: s.layers.chains.filter((c) => c.id !== id) } })) }
  setLayout(mode: LayoutMode) { this.store.set((s) => ({ layouts: { ...s.layouts, [s.kind]: mode } })); this.stage?.layout.reset() }
  set<K extends keyof AppState>(k: K, v: AppState[K]) { this.store.set({ [k]: v } as Partial<AppState>) }
  say(message: string | null) { this.store.set({ message }) }

  // ---------- takes ------------------------------------------------------------------------------
  toggleRecord() {
    if (this.rec) {
      const events = this.rec.events.filter((e) => e.t >= 0)
      const first = events.find((e) => e.ev.type === 'on')?.t ?? 0
      const shifted = events.map((e) => ({ t: Math.max(0, e.t - first), ev: e.ev }))
      this.rec = null
      this.store.set({ recording: false, take: shifted.length ? { name: `Take ${new Date().toLocaleTimeString()}`, events: shifted, duration: takeDuration(shifted) } : this.store.get().take })
    } else {
      this.stopTake()
      this.rec = { start: this.ctx.currentTime, events: [] }
      this.store.set({ recording: true })
    }
  }

  playTake() {
    const take = this.store.get().take
    if (!take || !this.performer) return
    this.stopTake()
    void this.ctx.resume()
    this.replaying = true
    const start = this.ctx.currentTime + 0.15
    let i = 0
    this.store.set({ playing: true })
    this.playTimer = window.setInterval(() => {
      const horizon = this.ctx.currentTime + 0.12
      while (i < take.events.length && start + take.events[i].t <= horizon) { this.performer!.play(take.events[i].ev, start + take.events[i].t); i++ }
      if (i >= take.events.length && this.ctx.currentTime > start + take.duration + 1) this.stopTake()
    }, 25)
  }

  stopTake() {
    if (!this.replaying) return
    clearInterval(this.playTimer)
    this.replaying = false
    this.performer?.panic(this.ctx.currentTime)
    this.store.set({ playing: false })
  }

  private async loadMidi(f: File) {
    try {
      const take = await midiToTake(f, f.name.replace(/\.[^.]+$/, ''))
      this.store.set({ take })
      this.say(`${take.name}: ${take.events.filter((e) => e.ev.type === 'on').length} notes loaded as a take. Play it or export it.`)
    } catch (e) { this.say(`Could not read ${f.name}: ${(e as Error).message}`) }
  }

  downloadMidi() {
    const take = this.store.get().take
    if (take) download(new Blob([takeToMidi(take) as BlobPart], { type: 'audio/midi' }), `${take.name}.mid`)
  }

  async export(opts: ExportOptions) {
    const s = this.store.get()
    if (!s.take || !this.stage || s.exporting) return
    this.stopTake()
    this.store.set({ exporting: { progress: 0, stage: 'Sound' } })
    try {
      const blob = await exportTake(s.take, {
        state: this.instrumentState(), clips: this.clips, levels: this.levels, stage: this.stage,
        homeCells: s.kind === 'pads' ? this.homeCells() : undefined, homeBase: this.bankBase(), fit: s.fit,
      }, opts, (progress, stage) => this.store.set({ exporting: { progress, stage } }))
      download(blob, `${s.take.name} ${opts.aspect.replace(':', 'x')}.mp4`)
    } catch (e) {
      this.say(`Export failed: ${(e as Error).message}`)
    } finally {
      this.stage.layout.reset()
      this.store.set({ exporting: null })
    }
  }
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export const app = new App()
