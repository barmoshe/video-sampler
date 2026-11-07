// The controller: owns the audio context, engine, performer and stage; React reads its store.
import { AudioEngine, audibleAt, scheduleTime } from './audio'
import {
  defaultClipParams, defaultLayersParams, defaultPadsParams, homeKey, newLayer, newPad, octaveFor, PAD_BASE,
  type ClipParams, type LayerChain, type LayersParams, type PadChain, type PadsParams,
} from './instruments'
import { attachKeyboard, connectMidi, MidiReceiver, type InputHandlers } from './input'
import { importClip } from './media'
import { History } from './history'
import { blocking, support } from './support'
import { defaultFx, delaySeconds, type FxSettings } from './fx'
import { askToKeep, canPersist, clearProject, loadProject, packProject, readClipFile, saveClipFile, saveProject, unpackProject, type SavedClip, type SavedProject } from './persist'
import { chordNotes, defaultScale, keyNote, snap, type ScaleSetting } from './scale'
import { clicksIn, defaultTransport, LayerRecorder, loopSeconds, nextBar, notesIn, SECTION_IDS, type Layer, type Section, type Transport } from './looper'
import type { MainPlace } from './performer'

export interface MainState { clipId: string | null; gain: number; alpha: number; place: MainPlace }
/** Pads performance modes: note repeat at a rate in beats with swing (MPC, Push), and 16 Levels (velocity). */
export interface PadPlay { repeat: boolean; rate: number; swing: number; levels: boolean }
/** 16 Levels: pad i of the block plays the selected pad at this velocity (soft bottom-left to hard top-right). */
export const levelVelocity = (i: number) => Math.round(8 + (i * 119) / 15)
import { Performer, type InstrumentState, type PlayEvent } from './performer'
import { CLEAN_LOOK, Stage, type Look } from './stage'
import { fileOf, loadManifest, type LibraryItem } from './library'
import { createStore } from './store'
import { capturePhrase, midiToTake, takeDuration, takeToMidi, type Take, type TakeEvent } from './take'
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
  scale: ScaleSetting
  transport: Transport
  loopLayers: Layer[] // the looper's layers (not the Layers instrument)
  redoLayers: Layer[]
  looping: boolean // the transport runs (loops play, the metronome clicks)
  loopRec: boolean // live playing is being recorded into layers, one per pass
  bar: number // the current bar (for the UI), −1 during the count-in
  fx: FxSettings // the effects bus's returns and glue
  padPlay: PadPlay // Pads performance modes (Push / MPC): note repeat, 16 Levels
  main: MainState // the current section's main video
  sections: Section<MainState, LayoutMode>[] // the other sections' state (the current one lives in loopLayers, main, layouts)
  section: string // the current section
  queued: string | null // the section that starts on the next bar
  velocity: number
  active: number[]
  recording: boolean
  take: Take | null // the current take (plays, exports)
  takes: Take[] // every take in the project
  playing: boolean
  midiDevices: string[] | null
  bpm: number | null
  pictureOffsetMs: number
  latencyMode: 'tight' | 'sync'
  exporting: { progress: number; stage: string } | null
  message: string | null
  voices: number
  audioOn: boolean
  savedAt: number | null // when the project last saved itself (null: not yet, or storage unavailable)
  canUndo: boolean
  canRedo: boolean
  look: Look // how tiles are framed (POST mode's looks)
  starting: boolean // the first visit's instrument is loading
}

/** The returns' picture twins, from the bus settings (stage.ts). */
export const echoOf = (fx: FxSettings, bpm: number) => ({ time: delaySeconds(fx, bpm), feedback: fx.delay.feedback, level: fx.delay.level, decay: fx.reverb.decay, reverb: fx.reverb.level })

/** What undo covers: the project's edits, not views or performance controls (tab, octave, velocity). */
const UNDO_KEYS = ['clip', 'pads', 'layers', 'bendRange', 'layouts', 'aspect', 'fit', 'scale', 'transport', 'loopLayers', 'sections', 'section', 'main', 'fx', 'take', 'takes', 'look'] as const
/** What autosave keeps: the edits plus the views and settings a reload should come back to. */
const SAVE_KEYS = [...UNDO_KEYS, 'kind', 'octave', 'velocity', 'pictureOffsetMs', 'latencyMode', 'padPlay'] as const
type UndoDoc = Pick<AppState, (typeof UNDO_KEYS)[number]>
const pick = <K extends keyof AppState>(s: AppState, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, s[k]])) as Pick<AppState, K>

const initial = (): AppState => ({
  clips: [], importing: null, kind: 'clip',
  clip: defaultClipParams(), pads: defaultPadsParams(), layers: defaultLayersParams(), bendRange: 2,
  layouts: { clip: 'gallery', pads: 'home', layers: 'gallery' }, aspect: '16:9', fit: false,
  octave: 0, scale: defaultScale(), velocity: 100,
  transport: defaultTransport(), loopLayers: [], redoLayers: [], looping: false, loopRec: false, bar: 0,
  main: { clipId: null, gain: 0.7, alpha: 1, place: 'behind' }, fx: defaultFx(),
  padPlay: { repeat: false, rate: 0.25, swing: 0, levels: false },
  sections: [], section: 'A', queued: null, active: [], recording: false, take: null, takes: [], playing: false,
  midiDevices: null, bpm: null, pictureOffsetMs: 50, latencyMode: 'tight', exporting: null, message: null, voices: 0, audioOn: false,
  savedAt: null, canUndo: false, canRedo: false, look: CLEAN_LOOK, starting: false,
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
    this.store.subscribe(() => this.onChange())
    this.history.reset()
    this.lastRefs = SAVE_KEYS.map((k) => this.store.get()[k])
  }

  private async boot() {
    const stop = blocking(support())
    if (stop) { this.say(stop); return }
    this.engine = await AudioEngine.create(this.ctx)
    this.engine.setFx(this.store.get().fx, this.store.get().transport.bpm)
    this.performer = new Performer(this.instrumentState(), this.clips, {
      send: (evs) => { void this.engine!.events(evs) },
      frameOf: (t) => Math.round(t * this.ctx.sampleRate),
    })
    this.performer.onPlay = (ev, t) => {
      if (this.replaying) return
      if (this.rec) this.rec.events.push({ t: t - this.rec.start, ev })
      this.captureBuf.push({ t, ev }) // Capture's always-on memory: the last two minutes
      if (this.captureBuf.length > 4000 || this.captureBuf[0].t < t - 120) this.captureBuf = this.captureBuf.filter((e) => e.t >= t - 120).slice(-4000)
    }
    void this.restore().then((had) => { if (!had) void this.loadStarter() })
  }

  private instrumentState(): InstrumentState {
    const s = this.store.get()
    return { kind: s.kind, clip: s.clip, pads: s.pads, layers: s.layers, bendRange: s.bendRange }
  }
  private syncPerformer() { if (this.performer) this.performer.state = this.instrumentState() }

  // ---------- undo, autosave, restore (production.md §3 J) ---------------------------------------
  history = new History<UndoDoc>(() => pick(this.store.get(), UNDO_KEYS), (d) => this.store.set(d))
  private clipFiles = new Map<string, string>() // clip id → its file in the browser's storage
  private restoring = false
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private lastRefs: unknown[] = []
  private asked = false

  /** Every store change: keep the performer in step; an edit settles into an undo step and a save. */
  private fxRefs: unknown[] = []
  private onChange() {
    this.syncPerformer()
    const st = this.store.get()
    if (this.engine && (st.fx !== this.fxRefs[0] || st.transport.bpm !== this.fxRefs[1])) { this.fxRefs = [st.fx, st.transport.bpm]; this.engine.setFx(st.fx, st.transport.bpm) }
    if (this.restoring) return
    const s = this.store.get()
    const refs = SAVE_KEYS.map((k) => s[k])
    if (refs.every((r, i) => r === this.lastRefs[i])) return
    this.lastRefs = refs
    this.history.changed()
    const can = { canUndo: this.history.canUndo, canRedo: this.history.canRedo }
    if (can.canUndo !== s.canUndo || can.canRedo !== s.canRedo) queueMicrotask(() => this.store.set(can))
    this.scheduleSave()
  }

  undo() { if (this.history.undo()) this.store.set({ canUndo: this.history.canUndo, canRedo: this.history.canRedo }) }
  redo() { if (this.history.redo()) this.store.set({ canUndo: this.history.canUndo, canRedo: this.history.canRedo }) }

  private scheduleSave() {
    if (!canPersist()) return
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.save(), 1000)
  }

  private async save() {
    const s = this.store.get()
    if (!s.clips.length && !s.take) return
    try {
      await saveProject({ v: 1, savedAt: Date.now(), clips: s.clips.flatMap((c) => (this.clipFiles.has(c.id) ? [{ id: c.id, name: c.name, file: this.clipFiles.get(c.id)! }] : [])), doc: pick(s, SAVE_KEYS) })
      this.store.set({ savedAt: Date.now() })
      if (!this.asked) { this.asked = true; void askToKeep() }
    } catch (e) { console.warn('[autosave]', (e as Error).message) }
  }

  /** On load: bring back the last project's clips (same ids) and settings. */
  private async restore(): Promise<boolean> {
    if (!canPersist()) return false
    const p = await loadProject()
    if (!p || !p.clips.length) return false
    await this.load(p, async (c) => readClipFile(c.file, c.name), 'Restoring', `Your last project is back (${p.clips.length} clip${p.clips.length === 1 ? '' : 's'}).`)
    return true
  }

  // ---------- the pack: the first visit's instrument, sounds from the library (ADR 0770, 0772) ---
  private manifest: Promise<LibraryItem[]> | null = null
  library() { return (this.manifest ??= loadManifest().catch(() => [])) }

  /** The first visit opens on an instrument that is already on: the pack's marimba on the Clip. */
  async loadStarter() {
    if (this.store.get().clips.length) return
    this.store.set({ starting: true })
    try {
      const item = (await this.library()).find((i) => i.id === 'marimba') ?? (await this.library()).find((i) => i.kind === 'pitched')
      if (item && !this.store.get().clips.length) await this.importFiles([await fileOf(item)])
    } catch (e) { console.warn('[starter]', (e as Error).message) } finally { this.store.set({ starting: false }) }
  }

  /** A pack sound onto the Clip, a pad or a new layer (wherever the player is working). */
  async loadItem(item: LibraryItem, target?: { pad?: number; layer?: string }) {
    const have = this.store.get().clips.find((c) => c.name === item.name) // already in the project: no second import
    if (have) { this.assign(have, target); return }
    try { await this.importFiles([await fileOf(item)], target) } catch (e) { this.say((e as Error).message) }
  }

  /** The pack's drums onto this bank's pads, bottom-left first. */
  async loadKit() {
    const drums = (await this.library()).filter((i) => i.kind === 'drum').slice(0, 16)
    const base = this.bankBase()
    for (let i = 0; i < drums.length; i++) await this.loadItem(drums[i], { pad: base + i })
    this.setPads({ selected: base })
  }

  /** Bring a project in: import each clip with its own id, then apply the saved settings. */
  private async load(p: SavedProject, fileFor: (c: SavedClip) => Promise<File | null>, verb: string, done: string) {
    await this.stageReady
    if (!this.engine) return
    this.restoring = true
    try {
      for (const c of p.clips) {
        if (this.clips.has(c.id)) continue
        const f = await fileFor(c)
        if (!f) continue
        this.store.set({ importing: { name: c.name, progress: 0, stage: verb } })
        const { clip, fwd, rev } = await importClip(f, c.name, this.ctx, this.stage!.cache, (q, stage) => this.store.set({ importing: { name: c.name, progress: q, stage: `${verb} · ${stage}` } }), c.id)
        this.clips.set(clip.id, clip)
        this.levels.set(clip.id, { fwd, rev })
        await this.engine.loadClip(clip.id, clip.fs, fwd, rev)
        if (canPersist()) this.clipFiles.set(clip.id, c.file && (await readClipFile(c.file, c.name)) ? c.file : await saveClipFile(f, f.name))
        this.store.set((s) => ({ clips: [...s.clips, clip] }))
      }
      const base = initial()
      const doc = p.doc as Partial<AppState>
      const merged: Partial<AppState> = {}
      for (const k of SAVE_KEYS) {
        if (!(k in doc)) continue
        const v = doc[k], b = base[k]
        ;(merged as Record<string, unknown>)[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b) ? { ...b, ...v } : v
      }
      this.store.set({ ...merged, importing: null, savedAt: p.savedAt })
      this.say(done)
    } catch (e) {
      this.say(`Could not open the project: ${(e as Error).message}`)
    } finally {
      this.restoring = false
      this.store.set({ importing: null })
      this.lastRefs = SAVE_KEYS.map((k) => this.store.get()[k])
      this.history.reset()
      this.scheduleSave()
    }
  }

  /** Download the whole project (settings and clips) as one file to keep or move. */
  async saveProjectFile() {
    const s = this.store.get()
    const files = new Map<string, File>()
    for (const c of s.clips) { const name = this.clipFiles.get(c.id); const f = name ? await readClipFile(name, c.name) : null; if (f) files.set(c.id, f) }
    if (s.clips.length && files.size < s.clips.length) { this.say('Some clips are not stored in this browser yet, so they cannot go into the file. Try again in a moment.'); return }
    const p: SavedProject = { v: 1, savedAt: Date.now(), clips: s.clips.map((c) => ({ id: c.id, name: c.name, file: this.clipFiles.get(c.id) ?? '' })), doc: pick(s, SAVE_KEYS) }
    download(await packProject(p, files), `video-sampler project ${new Date().toISOString().slice(0, 10)}.vsamp`)
  }

  /** Open a project file: its clips join this project, its settings replace these. */
  async openProjectFile(file: File) {
    try {
      const { project, files } = await unpackProject(file)
      await this.load(project, async (c) => files.get(c.id) ?? null, 'Opening', `Opened ${file.name} (${project.clips.length} clip${project.clips.length === 1 ? '' : 's'}).`)
    } catch (e) { this.say((e as Error).message) }
  }

  /** A new, empty project: forget the saved one and start over. */
  async newProject() {
    await clearProject()
    location.reload()
  }

  // ---------- stage ------------------------------------------------------------------------------
  private stageOk!: () => void
  private stageReady = new Promise<void>((ok) => { this.stageOk = ok })

  attachStage(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas)
    this.stageOk()
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
      hold: s.looping ? loopSeconds(s.transport) : 0, mainAlpha: s.main.alpha, section: s.section, echo: echoOf(s.fx, s.transport.bpm), look: s.look,
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

  // chord mode: a key's notes, and how many held keys hold each note (shared chord tones)
  private chords = new Map<number, number[]>()
  private held = new Map<number, number>()

  handlers: InputHandlers = {
    noteOn: (key, vel0, ts) => {
      const s = this.store.get()
      const melodic = s.kind !== 'pads'
      // 16 Levels: the block plays the selected pad at sixteen velocities
      const lvl = !melodic && s.padPlay.levels ? key - this.bankBase() : -1
      const vel = lvl >= 0 && lvl < 16 ? levelVelocity(lvl) : vel0
      const played = lvl >= 0 && lvl < 16 ? s.pads.selected : key
      const root = melodic && s.scale.lock ? snap(key, s.scale) : played
      const notes = melodic ? chordNotes(root, s.scale) : [played]
      if (this.chords.has(key)) this.handlers.noteOff(key, ts) // a retrigger releases the old chord first
      this.chords.set(key, notes)
      if (this.recorder) { const at = scheduleTime(this.ctx, ts, this.latencyMs()); for (const n of notes) this.recorder.on(n, vel, at) }
      for (const n of notes) {
        this.held.set(n, (this.held.get(n) ?? 0) + 1)
        this.play({ type: 'on', note: n, vel }, ts)
      }
      this.store.set((x) => ({ active: [...x.active.filter((n) => !notes.includes(n)), ...notes] }))
      if (!melodic && s.padPlay.repeat) this.startRepeat(key, notes, vel)
    },
    noteOff: (key, ts) => {
      this.repeaters.delete(key)
      const notes = this.chords.get(key) ?? [key]
      this.chords.delete(key)
      if (this.recorder) { const at = scheduleTime(this.ctx, ts, this.latencyMs()); for (const n of notes) this.recorder.off(n, at) }
      const off: number[] = []
      for (const n of notes) {
        const c = (this.held.get(n) ?? 1) - 1
        if (c > 0) { this.held.set(n, c); continue }
        this.held.delete(n)
        off.push(n)
        this.play({ type: 'off', note: n }, ts)
      }
      this.store.set((x) => ({ active: x.active.filter((n) => !off.includes(n)) }))
    },
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
    const undoKeys = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (!(e.metaKey || e.ctrlKey) || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) return
      if (e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo() }
      else if (e.code === 'KeyY') { e.preventDefault(); this.redo() }
    }
    addEventListener('keydown', undoKeys)
    const detach = attachKeyboard(this.handlers, () => {
      const s = this.store.get()
      return {
        mode: s.kind === 'pads' ? 'pads' : 'notes',
        baseNote: () => (s.kind === 'pads' ? this.bankBase() : 60 + 12 * s.octave),
        keyNote: s.kind !== 'pads' && s.scale.lock ? (code: string) => keyNote(code, 60 + 12 * s.octave, s.scale) : undefined,
        velocity: () => s.velocity,
        octave: (d) => this.store.set((x) => ({ octave: Math.max(-5, Math.min(4, x.octave + d)) })),
        velocityStep: (d) => this.store.set((x) => ({ velocity: Math.max(1, Math.min(127, x.velocity + d)) })),
        record: () => this.toggleRecord(),
        capture: () => this.capture(),
        loopRecord: () => this.loopRecord(),
        section: (i: number) => { const ids = [this.store.get().section, ...this.store.get().sections.map((x) => x.id)].sort(); if (ids[i]) this.switchSection(ids[i]) },
      }
    })
    return () => { detach(); removeEventListener('keydown', undoKeys) }
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
    if (!this.engine) return // the browser lacks what the app needs (the message is already showing)
    for (const f of files) {
      if (/\.vsamp$/i.test(f.name)) { await this.openProjectFile(f); continue }
      if (/\.midi?$/i.test(f.name) || f.type === 'audio/midi') { await this.loadMidi(f); continue }
      if (!this.stage) return
      this.store.set({ importing: { name: f.name, progress: 0, stage: 'Opening' } })
      try {
        const { clip, fwd, rev } = await importClip(f, f.name.replace(/\.[^.]+$/, ''), this.ctx, this.stage.cache, (p, stage) => this.store.set({ importing: { name: f.name, progress: p, stage } }))
        this.clips.set(clip.id, clip)
        this.levels.set(clip.id, { fwd, rev })
        await this.engine!.loadClip(clip.id, clip.fs, fwd, rev)
        if (canPersist()) void saveClipFile(f, f.name).then((name) => { this.clipFiles.set(clip.id, name); this.scheduleSave() }).catch((e) => console.warn('[autosave]', e))
        this.store.set((s) => ({ clips: [...s.clips, clip] }))
        this.assign(clip, target)
      } catch (e) {
        this.say(`Could not read ${f.name}: ${(e as Error).message}`)
      } finally {
        this.store.set({ importing: null })
      }
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
      this.setClip({ clipId: clip.id })
    }
  }

  removeClip(id: string) {
    this.clipFiles.delete(id)
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
  setKind(kind: InstrumentKind) { this.panic(); this.store.set({ kind }); if (kind === 'clip') this.followHome() }
  setClip(p: Partial<ClipParams>) {
    this.store.set((s) => ({ clip: { ...s.clip, ...p } }))
    if ('clipId' in p || 'tune' in p || 'root' in p || 'mode' in p) this.followHome()
  }

  /** The keyboard follows the clip: the QWERTY octave moves so the clip's home key is on the home row. */
  setFx(p: Partial<FxSettings>) { this.store.set((s) => ({ fx: { ...s.fx, ...p } })) }
  setScale(p: Partial<ScaleSetting>) { this.panic(); this.store.set((s) => ({ scale: { ...s.scale, ...p } })) }

  followHome() {
    const s = this.store.get()
    const clip = s.clips.find((c) => c.id === s.clip.clipId)
    if (s.kind !== 'clip' || !clip) return
    const octave = octaveFor(homeKey(s.clip, clip))
    if (octave !== s.octave) this.store.set({ octave })
  }
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

  // ---------- looper, transport, main video (ADR 0771) ------------------------------------------
  private loopT0 = 0
  private loopTimer = 0
  private scheduledTo = 0
  private recorder: LayerRecorder | null = null
  private recPass = 0
  private nextLayer = 1
  private mainOn: { clipId: string; at: number } | null = null
  private clickBufs: [AudioBuffer, AudioBuffer] | null = null

  setTransport(p: Partial<Transport>) {
    const s = this.store.get()
    if (s.looping && ('bpm' in p || 'bars' in p || 'beats' in p) && s.loopLayers.length) { this.say('Stop the loop to change its tempo or length.'); return }
    this.store.set({ transport: { ...s.transport, ...p } })
  }

  /** Start the transport: a bar of count-in if asked, then loops, the metronome and the main video. */
  loopStart(countIn = this.store.get().transport.countIn) {
    if (this.store.get().looping || !this.performer) return
    void this.ctx.resume()
    const tr = this.store.get().transport
    const bar = (60 / tr.bpm) * tr.beats
    this.loopT0 = this.ctx.currentTime + 0.12 + (countIn ? bar : 0)
    this.scheduledTo = this.ctx.currentTime
    this.store.set({ looping: true, bar: countIn ? -1 : 0 })
    const main = this.store.get().main
    if (main.clipId) this.startMain(main.clipId, this.loopT0)
    this.loopTimer = window.setInterval(() => this.loopTick(), 25)
  }

  loopStop() {
    if (!this.store.get().looping) return
    clearInterval(this.loopTimer)
    if (this.recorder) this.closeLayer(this.ctx.currentTime)
    this.recorder = null
    this.performer?.panic(this.ctx.currentTime)
    this.stopMain()
    this.store.set({ looping: false, loopRec: false, bar: 0 })
  }

  /** Record live playing into layers, one per pass, until pressed again (the RC-505's overdub). */
  loopRecord() {
    const s = this.store.get()
    if (s.loopRec) {
      if (this.recorder) this.closeLayer(this.ctx.currentTime)
      this.recorder = null
      this.store.set({ loopRec: false })
      return
    }
    if (!s.looping) this.loopStart()
    const L = loopSeconds(this.store.get().transport)
    this.recPass = Math.max(0, Math.floor((this.ctx.currentTime - this.loopT0) / L))
    this.recorder = new LayerRecorder(this.loopT0, this.store.get().transport)
    this.store.set({ loopRec: true })
  }

  private closeLayer(t: number) {
    if (!this.recorder) return
    const notes = this.recorder.finish(t)
    if (notes.length) this.store.set((s) => ({ loopLayers: [...s.loopLayers, { id: this.nextLayer++, notes, muted: false }], redoLayers: [] }))
  }

  loopUndo() { this.store.set((s) => (s.loopLayers.length ? { loopLayers: s.loopLayers.slice(0, -1), redoLayers: [...s.redoLayers, s.loopLayers[s.loopLayers.length - 1]] } : {})) }
  loopRedo() { this.store.set((s) => (s.redoLayers.length ? { loopLayers: [...s.loopLayers, s.redoLayers[s.redoLayers.length - 1]], redoLayers: s.redoLayers.slice(0, -1) } : {})) }
  muteLayer(id: number) { this.store.set((s) => ({ loopLayers: s.loopLayers.map((l) => (l.id === id ? { ...l, muted: !l.muted } : l)) })) }
  loopClear() { this.loopStop(); this.store.set({ loopLayers: [], redoLayers: [] }) }

  /** Every 25 ms: schedule the next 150 ms of loop notes and clicks on the audio clock. */
  private loopTick() {
    const s = this.store.get(), tr = s.transport, now = this.ctx.currentTime
    const from = this.scheduledTo
    const switchAt = s.queued ? nextBar(Math.max(from, now), this.loopT0, tr) : Infinity
    const to = Math.min(now + 0.15, switchAt)
    for (const x of notesIn(s.loopLayers, this.loopT0, tr, Math.max(from, this.loopT0), to)) {
      const src = 100 + x.layer, cell = `L:${s.section}:${x.layer}`
      this.performer!.play({ type: 'on', note: x.n.note, vel: x.n.vel, src, cell }, x.on)
      this.performer!.play({ type: 'off', note: x.n.note, src }, x.off)
    }
    const countIn = this.loopT0 - (60 / tr.bpm) * tr.beats
    if (tr.metronome || now < this.loopT0) for (const c of clicksIn(Math.min(countIn, this.loopT0), tr, Math.max(from, countIn), to)) this.click(c.t, c.accent)
    this.scheduledTo = to
    if (s.queued && to >= switchAt) { this.applySection(s.queued, switchAt); return }
    // a recording pass ends at the loop boundary: its notes become a layer, the next pass records anew
    const L = loopSeconds(tr), pass = Math.floor((now - this.loopT0) / L)
    if (this.recorder && pass > this.recPass) {
      this.closeLayer(this.loopT0 + pass * L)
      this.recorder = new LayerRecorder(this.loopT0, tr)
      this.recPass = pass
    }
    const bar = now < this.loopT0 ? -1 : Math.floor((now - this.loopT0) / ((60 / tr.bpm) * tr.beats)) % tr.bars
    if (bar !== s.bar) this.store.set({ bar })
  }

  /** The metronome: a short tick on the audio clock, not recorded in takes or exports. */
  private click(t: number, accent: boolean) {
    if (!this.clickBufs) {
      const make = (f: number) => {
        const n = Math.round(this.ctx.sampleRate * 0.03), b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0)
        for (let i = 0; i < n; i++) d[i] = Math.sin((2 * Math.PI * f * i) / this.ctx.sampleRate) * Math.exp(-i / (this.ctx.sampleRate * 0.006))
        return b
      }
      this.clickBufs = [make(1800), make(2600)]
    }
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain()
    src.buffer = this.clickBufs[accent ? 1 : 0]
    g.gain.value = accent ? 0.35 : 0.22
    src.connect(g).connect(this.ctx.destination)
    src.start(Math.max(t, this.ctx.currentTime))
  }

  /** The main video behind the tiles: its picture and its sound, looping (ADR 0771). */
  setMain(p: Partial<AppState['main']>) {
    const before = this.store.get().main
    this.store.set((s) => ({ main: { ...s.main, ...p } }))
    const m = this.store.get().main
    if ('clipId' in p || 'place' in p || ('gain' in p && m.gain !== before.gain)) {
      if (m.clipId) this.startMain(m.clipId, this.ctx.currentTime + 0.05)
      else this.stopMain()
    }
  }
  private startMain(clipId: string, at: number, fromStart = false) {
    const clip = this.clips.get(clipId)
    if (!clip || !this.performer) return
    const offset = !fromStart && this.mainOn && this.mainOn.clipId === clipId ? (at - this.mainOn.at) % clip.duration : 0
    const m = this.store.get().main
    this.performer.play({ type: 'main', clipId, gain: m.gain, offset, place: m.place }, at)
    this.mainOn = { clipId, at: at - offset }
  }
  private stopMain(at = this.ctx.currentTime) {
    this.performer?.play({ type: 'main', clipId: null, gain: 0 }, at)
    this.mainOn = null
  }

  /** Go to a section: on the next bar while the loops run, at once otherwise. */
  switchSection(id: string) {
    const s = this.store.get()
    if (id === s.section) { if (s.queued) this.store.set({ queued: null }); return }
    if (!s.sections.some((x) => x.id === id)) return
    if (s.looping) this.store.set({ queued: id })
    else this.applySection(id, this.ctx.currentTime)
  }

  /** A new empty section after the last, with the current main video and layout; switch to it. */
  addSection() {
    const s = this.store.get()
    const used = new Set([s.section, ...s.sections.map((x) => x.id)])
    const id = SECTION_IDS.find((x) => !used.has(x))
    if (!id) return
    this.store.set({ sections: [...s.sections, { id, layers: [], main: { ...s.main }, layout: s.layouts[s.kind] }] })
    this.switchSection(id)
  }

  /** The switch itself, at audio time `at`: save the current section, load the next, re-anchor the loop. */
  private applySection(id: string, at: number) {
    const s = this.store.get()
    const target = s.sections.find((x) => x.id === id)
    if (!target) return
    if (this.recorder) { this.closeLayer(at); this.recorder = null }
    const current: Section<MainState, LayoutMode> = { id: s.section, layers: this.store.get().loopLayers, main: s.main, layout: s.layouts[s.kind] }
    const layout = target.layout ?? s.layouts[s.kind]
    this.store.set({
      sections: [...s.sections.filter((x) => x.id !== id), current].sort((a, b) => a.id.localeCompare(b.id)),
      section: id, queued: null, loopLayers: target.layers, redoLayers: [], main: target.main,
      layouts: { ...s.layouts, [s.kind]: layout },
    })
    if (s.looping) {
      this.loopT0 = at // the new section's loops start from their first bar
      this.scheduledTo = at
      if (s.loopRec) { this.recPass = 0; this.recorder = new LayerRecorder(at, this.store.get().transport) }
    }
    this.performer?.play({ type: 'layout', mode: layout, section: id }, at) // a cue the take keeps for the export
    if (target.main.clipId !== s.main.clipId || target.main.place !== s.main.place) {
      if (target.main.clipId && (s.looping || s.main.clipId)) this.startMain(target.main.clipId, at, true)
      else if (!target.main.clipId) this.stopMain(at)
    }
  }

  // ---------- pads: note repeat, 16 Levels, multi-drop, swap and layer ---------------------------
  private repeaters = new Map<number, { notes: number[]; vel: number; next: number; k: number }>()
  private repeatTimer = 0

  setPadPlay(p: Partial<PadPlay>) { this.store.set((s) => ({ padPlay: { ...s.padPlay, ...p } })); if (p.repeat === false) this.repeaters.clear() }

  /** Note repeat: while a pad is held it retriggers on the grid (the loop's, if it runs), with swing. */
  private startRepeat(key: number, notes: number[], vel: number) {
    const s = this.store.get(), step = (s.padPlay.rate * 60) / s.transport.bpm, now = this.ctx.currentTime
    const first = s.looping ? this.loopT0 + Math.ceil((now + 0.01 - this.loopT0) / step) * step : now + step
    this.repeaters.set(key, { notes, vel, next: first, k: 1 })
    if (!this.repeatTimer) this.repeatTimer = window.setInterval(() => this.repeatTick(), 10)
  }

  private repeatTick() {
    if (!this.repeaters.size) { clearInterval(this.repeatTimer); this.repeatTimer = 0; return }
    const s = this.store.get(), step = (s.padPlay.rate * 60) / s.transport.bpm, horizon = this.ctx.currentTime + 0.08
    for (const r of this.repeaters.values()) {
      while (r.next < horizon) {
        const len = Math.min(step * 0.9, 0.15)
        for (const n of r.notes) {
          this.performer!.play({ type: 'on', note: n, vel: r.vel, src: 50 }, r.next)
          this.performer!.play({ type: 'off', note: n, src: 50 }, r.next + len)
          this.recorder?.on(n, r.vel, r.next); this.recorder?.off(n, r.next + len)
        }
        r.next += step * (r.k % 2 ? 1 + s.padPlay.swing : 1 - s.padPlay.swing) // swing pushes every second hit late
        r.k++
      }
    }
  }

  /** Several clips dropped on a pad fill it and the pads after it (Ableton maps them upward). */
  async importToPads(files: File[], first: number) {
    for (let i = 0; i < files.length && first + i <= 127; i++) await this.importFiles([files[i]], { pad: first + i })
  }

  /** Drag a pad onto another: they swap places, sound and picture (Drum Rack). */
  swapPads(a: number, b: number) {
    if (a === b) return
    this.store.set((s) => ({ pads: { ...s.pads, chains: s.pads.chains.map((c) => (c.note === a ? { ...c, note: b } : c.note === b ? { ...c, note: a } : c)), selected: b } }))
  }

  /** Alt-drag a pad onto another: its clips join that pad, which then plays both (a layered pad). */
  layerPad(from: number, to: number) {
    if (from === to) return
    this.store.set((s) => ({ pads: { ...s.pads, chains: [...s.pads.chains, ...s.pads.chains.filter((c) => c.note === from).map((c) => ({ ...c, note: to }))], selected: to } }))
  }

  // ---------- takes ------------------------------------------------------------------------------
  private captureBuf: TakeEvent[] = []

  private addTake(t: Take) {
    const take = { ...t, id: t.id ?? `t${Date.now().toString(36)}` }
    this.store.set((s) => ({ take, takes: [...s.takes, take] }))
  }

  /** Keep what was just played as a take, without having pressed Record (Shift+Enter). */
  capture() {
    const got = capturePhrase(this.captureBuf, this.ctx.currentTime)
    if (!got) { this.say('Nothing played in the last two minutes to capture.'); return }
    const events = [...got.events]
    if (this.mainOn) { // the bed was playing: the take starts it where it was at the phrase's start
      const clip = this.clips.get(this.mainOn.clipId)
      if (clip) events.unshift({ t: 0, ev: { type: 'main', clipId: clip.id, gain: this.store.get().main.gain, offset: (got.start - this.mainOn.at) % clip.duration, place: this.store.get().main.place } })
    }
    const s = this.store.get()
    this.addTake({ name: `Capture ${new Date().toLocaleTimeString()}`, events, duration: takeDuration(events), hold: s.looping ? loopSeconds(s.transport) : undefined })
    this.say(`Captured ${events.filter((e) => e.ev.type === 'on').length} notes as a take.`)
  }

  selectTake(id: string) { this.stopTake(); this.store.set((s) => ({ take: s.takes.find((t) => t.id === id) ?? s.take })) }
  deleteTake(id: string) {
    this.stopTake()
    this.store.set((s) => { const takes = s.takes.filter((t) => t.id !== id); return { takes, take: s.take?.id === id ? takes.at(-1) ?? null : s.take } })
  }

  toggleRecord() {
    if (this.rec) {
      const events = this.rec.events.filter((e) => e.t >= 0)
      // a take over loops or a main video keeps its own timeline (the bed starts at 0)
      const first = events.some((e) => e.ev.type === 'main' || e.ev.type === 'layout') ? 0 : events.find((e) => e.ev.type === 'on')?.t ?? 0
      const shifted = events.map((e) => ({ t: Math.max(0, e.t - first), ev: e.ev }))
      this.rec = null
      const hold = this.store.get().looping ? loopSeconds(this.store.get().transport) : undefined
      if (shifted.length) this.addTake({ name: `Take ${new Date().toLocaleTimeString()}`, events: shifted, duration: takeDuration(shifted), hold })
      this.store.set({ recording: false })
    } else {
      this.stopTake()
      this.rec = { start: this.ctx.currentTime, events: [] }
      if (this.mainOn) { // the bed is already playing: the take starts it where it is now
        const clip = this.clips.get(this.mainOn.clipId)
        if (clip) this.rec.events.push({ t: 0, ev: { type: 'main', clipId: clip.id, gain: this.store.get().main.gain, offset: (this.ctx.currentTime - this.mainOn.at) % clip.duration, place: this.store.get().main.place } })
      }
      if (this.store.get().sections.length) this.rec.events.push({ t: 0, ev: { type: 'layout', mode: this.store.get().layouts[this.store.get().kind], section: this.store.get().section } })
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
      this.addTake(take)
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
        fx: s.fx, bpm: s.transport.bpm, look: s.look,
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
