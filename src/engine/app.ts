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
import { clicksIn, defaultTransport, LayerRecorder, loopBeats, type Transport } from './looper'
import { audible, compileSong, newTrack, placeScene, sceneEvents, sceneLen, songEnd, timelineEvents, TimelineRecorder, uid, type Mark, type Mix, type Scene, type SongClip, type SongEvent, type Track, type TrackKind } from './song'
import { VoiceBook } from './voicebook'

/** Pads performance modes: note repeat at a rate in beats with swing (MPC, Push), and 16 Levels (velocity). */
export interface PadPlay { repeat: boolean; rate: number; swing: number; levels: boolean }
/** 16 Levels: pad i of the block plays the selected pad at this velocity (soft bottom-left to hard top-right). */
export const levelVelocity = (i: number) => Math.round(8 + (i * 119) / 15)
import { Performer, type InstrumentState, type PlayEvent, type Sink, type TrackMix } from './performer'
import { CLEAN_LOOK, LOOKS, Stage, type Look } from './stage'
import { fileOf, loadManifest, type LibraryItem } from './library'
import { createStore } from './store'
import { capturePhrase, midiToTake, takeDuration, takeToMidi, type Take, type TakeEvent } from './take'
import type { Clip, InstrumentKind, LayoutMode, StageAspect } from './types'
import { exportTake, type ExportOptions } from './export'

/** Where a new clip goes: a pad, a layer, or a video or backing track at a beat. */
export interface Target { pad?: number; layer?: string; track?: string; at?: number }

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
  // the song (ADR 0773): tracks, the board's scenes and the timeline; kind/clip/pads/layers above are
  // the selected track's instrument, written back into its track when another track is selected
  tracks: Track[]
  sel: string // the selected track
  scenes: Scene[]
  marks: Mark[] // where scenes were placed on the timeline
  view: 'board' | 'timeline'
  trackLayout: LayoutMode // how the stage arranges the tracks' tiles
  songOn: 'board' | 'timeline' | null // what is playing
  sceneOn: string | null // the board's scene that is playing
  queuedScene: string | null // the scene that starts on the next bar
  songRec: 'board' | 'timeline' | null // live playing is being recorded into the selected track
  pos: number // the timeline's playhead when stopped (beats)
  fx: FxSettings // the effects bus's returns and glue
  padPlay: PadPlay // Pads performance modes (Push / MPC): note repeat, 16 Levels
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
const UNDO_KEYS = ['kind', 'clip', 'pads', 'layers', 'bendRange', 'layouts', 'aspect', 'fit', 'scale', 'transport', 'tracks', 'sel', 'scenes', 'marks', 'trackLayout', 'fx', 'take', 'takes', 'look'] as const
/** What autosave keeps: the edits plus the views and settings a reload should come back to. */
const SAVE_KEYS = [...UNDO_KEYS, 'octave', 'velocity', 'pictureOffsetMs', 'latencyMode', 'padPlay', 'view', 'pos'] as const
type UndoDoc = Pick<AppState, (typeof UNDO_KEYS)[number]>
const pick = <K extends keyof AppState>(s: AppState, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, s[k]])) as Pick<AppState, K>

const initial = (): AppState => ({
  clips: [], importing: null, kind: 'clip',
  clip: defaultClipParams(), pads: defaultPadsParams(), layers: defaultLayersParams(), bendRange: 2,
  layouts: { clip: 'gallery', pads: 'home', layers: 'gallery' }, aspect: '16:9', fit: false,
  octave: 0, scale: defaultScale(), velocity: 100,
  transport: defaultTransport(), fx: defaultFx(),
  tracks: [], sel: '', scenes: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], marks: [], view: 'board', trackLayout: 'gallery',
  songOn: null, sceneOn: null, queuedScene: null, songRec: null, pos: 0,
  padPlay: { repeat: false, rate: 0.25, swing: 0, levels: false },
  active: [], recording: false, take: null, takes: [], playing: false,
  midiDevices: null, bpm: null, pictureOffsetMs: 50, latencyMode: 'tight', exporting: null, message: null, voices: 0, audioOn: false,
  savedAt: null, canUndo: false, canRedo: false, look: CLEAN_LOOK, starting: false,
})

export class App {
  store = createStore<AppState>(initial())
  ctx = new AudioContext({ latencyHint: 'interactive' })
  engine: AudioEngine | null = null
  stage: Stage | null = null
  readonly book = new VoiceBook() // every track's voices, so the stage and the export see one song
  base: Performer | null = null // the song's own voice: backing beds, picture cues, takes with no track
  performers = new Map<string, Performer>() // one per instrument and video track
  private sink!: Sink
  /** The selected track's performer: where the keys, pads and MIDI play. */
  get performer(): Performer | null { return this.performers.get(this.store.get().sel) ?? this.base }
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
    this.sink = { send: (evs) => { void this.engine!.events(evs) }, frameOf: (t) => Math.round(t * this.ctx.sampleRate) }
    this.base = new Performer(this.instrumentState(), this.clips, this.sink, { book: this.book })
    this.base.onPlay = this.hook(this.base)
    this.ensureSong()
    void this.restore().then((had) => { if (!had) void this.loadStarter() })
  }

  private instrumentState(): InstrumentState {
    const s = this.store.get()
    return { kind: s.kind, clip: s.clip, pads: s.pads, layers: s.layers, bendRange: s.bendRange }
  }
  /** Takes and Capture hear every performer; a note is tagged with its track so it replays on it. */
  private hook(p: Performer) {
    return (ev: PlayEvent, t: number) => {
      if (ev.type === 'main') this.mainOn = ev.clipId ? { clipId: ev.clipId, at: t - (ev.offset ?? 0), gain: ev.gain } : null
      if (this.replaying) return
      const tagged: PlayEvent = p.track && (ev.type === 'on' || ev.type === 'off') ? { ...ev, track: p.track } : ev
      if (this.rec) this.rec.events.push({ t: t - this.rec.start, ev: tagged })
      this.captureBuf.push({ t, ev: tagged }) // Capture's always-on memory: the last two minutes
      if (this.captureBuf.length > 4000 || this.captureBuf[0].t < t - 120) this.captureBuf = this.captureBuf.filter((e) => e.t >= t - 120).slice(-4000)
    }
  }
  private mainOn: { clipId: string; at: number; gain: number } | null = null

  /** Keep one performer per instrument and video track, each on its track's instrument. */
  private syncPerformer() {
    if (!this.base) return
    const s = this.store.get()
    this.base.state = this.instrumentState()
    const keep = new Set<string>()
    for (const t of s.tracks) {
      if (t.kind !== 'instrument' && t.kind !== 'video') continue
      keep.add(t.id)
      const state = t.id === s.sel ? this.instrumentState() : { ...t.inst, bendRange: s.bendRange }
      const p = this.performers.get(t.id)
      if (p) { p.state = state; continue }
      const np = new Performer(state, this.clips, this.sink, { book: this.book, track: t.id, mix: () => this.mixOf(t.id) })
      np.onPlay = this.hook(np)
      this.performers.set(t.id, np)
    }
    for (const [id, p] of this.performers) if (!keep.has(id)) { p.panic(this.ctx.currentTime); this.performers.delete(id) }
  }

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
  async loadItem(item: LibraryItem, target?: Target) {
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
      this.ensureSong()
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
    if (!this.stage || !this.base || s.exporting) return
    // math §2 with the hand films' calibration: draw for the audio audible when this frame reaches
    // the eye, one frame plus the measured picture offset ahead
    const t = audibleAt(this.ctx, now) + 1 / 60 + s.pictureOffsetMs / 1000
    let layout = s.trackLayout, look = s.look
    for (const c of this.cues) if (c.t <= t) { if (c.layout) layout = c.layout; if (c.look) look = c.look }
    const n = this.stage.drawAt(t, now / 1000, this.book.voices, this.clips, {
      mode: s.layouts[s.kind], fit: s.fit, homeCells: s.kind === 'pads' ? this.homeCells() : undefined, homeBase: this.bankBase(),
      echo: echoOf(s.fx, s.transport.bpm), look,
      tracks: this.trackTiles(), trackMode: layout, holdTracks: s.songOn ? 1e9 : 2.5,
    })
    if (n !== this.lastCount) { this.lastCount = n; this.store.set({ voices: n }) }
    if (Math.random() < 0.02) this.book.prune(this.ctx.currentTime)
  }

  bankBase() { return PAD_BASE + this.store.get().pads.bank * 16 }
  homeCells() {
    const base = this.bankBase(), s = this.store.get(), chains = s.pads.chains
    return Array.from({ length: 16 }, (_, i) => ({ key: `p:${base + i}@${s.sel}`, order: i, clipId: chains.find((c) => c.note === base + i)?.clipId ?? null, track: s.sel }))
  }
  /** The tracks as the stage lays them out: their order, and how each lays out its own notes. */
  trackTiles() {
    const s = this.store.get()
    return this.songTracks().filter((t) => t.kind === 'instrument' || t.kind === 'video').map((t, i) => ({ id: t.id, order: i, mode: t.kind === 'video' ? 'gallery' as const : s.layouts[t.inst.kind] }))
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
      if (this.recording()) { const at = scheduleTime(this.ctx, ts, this.latencyMs()); for (const n of notes) this.recOn(n, vel, at) }
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
      if (this.recording()) { const at = scheduleTime(this.ctx, ts, this.latencyMs()); for (const n of notes) this.recOff(n, at) }
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
        record: () => this.songRecord(),
        capture: () => this.capture(),
        loopRecord: () => this.songRecord(),
        section: (i: number) => { const sc = this.store.get().scenes[i]; if (sc) this.launchScene(sc.id) },
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

  panic() { for (const p of this.performers.values()) p.panic(this.ctx.currentTime); this.base?.panic(this.ctx.currentTime); this.store.set({ active: [] }) }

  // ---------- clips ------------------------------------------------------------------------------
  async importFiles(files: File[], target?: Target) {
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
  private assign(clip: Clip, target?: Target) {
    const s = this.store.get()
    // a video or backing track takes the video as it is: on the timeline at the playhead (ADR 0773)
    const tr = this.songTracks().find((t) => t.id === (target?.track ?? s.sel))
    if (tr && (tr.kind === 'backing' || tr.kind === 'video') && target?.pad === undefined && target?.layer === undefined) {
      const inst = { ...tr.inst, clip: { ...tr.inst.clip, clipId: clip.id } }
      if (tr.kind === 'video') { if (tr.id === s.sel) this.setClip({ clipId: clip.id }); else this.setTrack(tr.id, { inst }) }
      this.placeMedia(clip, { ...tr, inst }, target?.at ?? s.pos)
      return
    }
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

  // ---------- the song: tracks, the board and the timeline (ADR 0773) ----------------------------
  /** The playhead, apart from the store: it moves twenty times a second and only the views that show it listen. */
  clock = createStore({ beat: 0 })
  private songT0 = 0 // audio time of beat 0 (the timeline's start, or the scene's launch on the board)
  private schedBeat = 0 // scheduled up to this beat
  private clickedTo = 0 // metronome scheduled up to this audio time
  private songTimer = 0
  private sceneOrigin = 0 // the beat the playing scene started on
  private firstWindow = false
  private boardRec: { rec: LayerRecorder; pass: number; len: number; scene: string; track: string } | null = null
  private tlRec: { rec: TimelineRecorder; track: string } | null = null
  private cues: { t: number; layout?: LayoutMode; look?: Look }[] = [] // picture cues already scheduled (live)
  private clickBufs: [AudioBuffer, AudioBuffer] | null = null

  /** A song always has a track: an old project or a first visit gets one, on the current instrument. */
  private ensureSong() {
    const s = this.store.get()
    if (s.tracks.length && s.tracks.some((t) => t.id === s.sel)) return
    if (s.tracks.length) { const t = s.tracks.find((x) => x.kind === 'instrument' || x.kind === 'video') ?? s.tracks[0]; this.store.set({ sel: t.id, kind: t.inst.kind, clip: t.inst.clip, pads: t.inst.pads, layers: t.inst.layers }); return }
    const t = newTrack('instrument', { kind: s.kind, clip: s.clip, pads: s.pads, layers: s.layers }, 0, 'Keys')
    this.store.set({ tracks: [t], sel: t.id })
  }

  /** The tracks with the selected one's instrument as it is now (the store keeps it apart while selected). */
  songTracks(): Track[] {
    const s = this.store.get()
    return s.tracks.map((t) => (t.id === s.sel ? { ...t, inst: { kind: s.kind, clip: s.clip, pads: s.pads, layers: s.layers } } : t))
  }
  selected(): Track | undefined { return this.songTracks().find((t) => t.id === this.store.get().sel) }

  mixOf(id: string): TrackMix {
    const s = this.store.get(), t = s.tracks.find((x) => x.id === id)
    return t ? { gain: Math.pow(10, t.mix.volume / 20), pan: t.mix.pan, on: audible(t, s.tracks) } : { gain: 1, pan: 0, on: true }
  }
  /** Where an event plays: a note on its track's performer, everything else on the song's own. */
  private route(ev: PlayEvent): Performer {
    const id = (ev.type === 'on' || ev.type === 'off') && ev.track ? ev.track : null
    return (id && this.performers.get(id)) || this.base!
  }

  selectTrack(id: string) {
    const s = this.store.get()
    const t = s.tracks.find((x) => x.id === id)
    if (!t || id === s.sel) return
    this.store.set({ tracks: this.songTracks(), sel: id, kind: t.inst.kind, clip: t.inst.clip, pads: t.inst.pads, layers: t.inst.layers })
    this.followHome()
  }

  /** A new track of a kind; instrument and video tracks are selected so the keys play them. */
  addTrack(kind: TrackKind): Track {
    const s = this.store.get()
    const inst = { kind: 'clip' as const, clip: defaultClipParams(), pads: defaultPadsParams(), layers: defaultLayersParams() }
    if (kind === 'video') inst.clip = { ...inst.clip, mode: 'oneshot', tune: 'original', loop: false }
    const t = newTrack(kind, inst, s.tracks.length)
    this.store.set({ tracks: [...this.songTracks(), t] })
    if (kind === 'instrument' || kind === 'video') this.selectTrack(t.id)
    return t
  }
  removeTrack(id: string) {
    const s = this.store.get()
    const left = s.tracks.filter((t) => t.id !== id)
    if (!left.some((t) => t.kind === 'instrument' || t.kind === 'video')) { this.say('A song keeps at least one instrument or video track.'); return }
    if (id === s.sel) this.selectTrack(left.find((t) => t.kind === 'instrument' || t.kind === 'video')!.id)
    this.store.set((x) => ({ tracks: x.tracks.filter((t) => t.id !== id) }))
  }
  setTrack(id: string, p: Partial<Omit<Track, 'mix'>>) { this.store.set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...p } : t)) })) }
  /** The fader, pan, mute and solo; held notes follow the fader at once. */
  setMix(id: string, p: Partial<Mix>) {
    const before = new Map([...this.performers].map(([k]) => [k, this.mixOf(k).gain]))
    this.store.set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, mix: { ...t.mix, ...p } } : t)) }))
    for (const [k, p2] of this.performers) p2.retrack(this.mixOf(k).on ? this.mixOf(k).gain / (before.get(k) || 1) : 1, this.ctx.currentTime)
    if (p.mute || p.solo !== undefined) for (const [k, p2] of this.performers) if (!this.mixOf(k).on) p2.panic(this.ctx.currentTime)
  }

  addScene() {
    const s = this.store.get()
    const id = 'ABCDEFGHIJKL'.split('').find((x) => !s.scenes.some((sc) => sc.id === x))
    if (id) this.store.set({ scenes: [...s.scenes, { id, name: id }] })
  }
  setCell(track: string, scene: string, clip: SongClip | null) {
    this.store.set((s) => ({ tracks: s.tracks.map((t) => {
      if (t.id !== track) return t
      const cells = { ...t.cells }
      if (clip) cells[scene] = clip; else delete cells[scene]
      return { ...t, cells }
    }) }))
  }
  setClipAt(track: string, id: string, p: Partial<SongClip> | null) {
    this.store.set((s) => ({ tracks: s.tracks.map((t) => (t.id !== track ? t : { ...t, clips: p === null ? t.clips.filter((c) => c.id !== id) : t.clips.map((c) => (c.id === id ? { ...c, ...p } : c)).sort((a, b) => a.start - b.start) })) }))
  }
  /** A scene from the board onto the timeline: at the song's end, or at `at` beats. */
  placeScene(scene: string, at = songEnd(this.songTracks())) {
    const s = this.store.get()
    const { tracks, mark } = placeScene(s.tracks, scene, at, s.transport.beats)
    if (mark.len && !tracks.some((t, i) => t !== s.tracks[i])) { this.say(`Scene ${scene} is empty: record or load something into it first.`); return }
    this.store.set({ tracks, marks: [...s.marks.filter((m) => m.at + m.len <= at || m.at >= at + mark.len), mark].sort((a, b) => a.at - b.at) })
  }
  setPos(beat: number) { const b = Math.max(0, beat); this.store.set({ pos: b }); this.clock.set({ beat: b }) }

  // ---- the transport
  setTransport(p: Partial<Transport>) {
    const s = this.store.get()
    if (s.songOn && ('bpm' in p || 'beats' in p)) { this.say('Stop the song to change its tempo.'); return }
    this.store.set({ transport: { ...s.transport, ...p } })
  }
  private spb() { return 60 / this.store.get().transport.bpm }

  /** Play the board (from the selected scene) or the timeline (from the playhead). */
  songStart(where: 'board' | 'timeline' = this.store.get().view, countIn = false) {
    if (!this.base) return
    this.songStop()
    void this.ctx.resume()
    const s = this.store.get(), spb = this.spb(), lead = 0.12 + (countIn ? spb * s.transport.beats : 0)
    const start = this.ctx.currentTime + lead
    if (where === 'timeline') {
      this.songT0 = start - s.pos * spb
      this.schedBeat = s.pos
    } else {
      const scene = s.queuedScene ?? s.sceneOn ?? s.scenes[0]?.id ?? null
      this.songT0 = start
      this.schedBeat = 0
      this.sceneOrigin = 0
      this.store.set({ sceneOn: scene, queuedScene: null })
    }
    this.clickedTo = this.ctx.currentTime
    this.firstWindow = true
    this.cues = []
    this.store.set({ songOn: where })
    this.songTimer = window.setInterval(() => this.songTick(), 25)
  }

  songStop() {
    const s = this.store.get()
    if (!s.songOn) return
    clearInterval(this.songTimer)
    const now = this.ctx.currentTime
    this.closeRecording(now)
    for (const p of this.performers.values()) p.panic(now)
    this.base?.play({ type: 'main', clipId: null, gain: 0 }, now)
    this.cues = []
    this.store.set({ songOn: null, sceneOn: s.songOn === 'board' ? null : s.sceneOn, queuedScene: null, songRec: null, active: [] })
    if (s.songOn === 'timeline') this.clock.set({ beat: s.pos })
  }

  /** A scene on the board: at once when stopped, on the next bar while the board plays. */
  launchScene(id: string) {
    const s = this.store.get()
    if (s.songOn === 'board') { if (id !== s.sceneOn) this.store.set({ queuedScene: id }); return }
    this.store.set({ sceneOn: id, view: 'board' })
    this.songStart('board')
  }

  private fire(e: SongEvent, t: number) {
    const ev = e.ev
    if (ev.type === 'layout') { this.cues.push({ t, layout: ev.mode }); this.base!.play(ev, t); return }
    if (ev.type === 'look') { const l = LOOKS.find((x) => x.id === ev.look); if (l) this.cues.push({ t, look: l.look }); this.base!.play(ev, t); return }
    this.route(ev).play(ev, t)
  }

  /** Every 25 ms: the next 150 ms of the board or the timeline, the metronome, and recording passes. */
  private songTick() {
    const s = this.store.get(), tr = s.transport, spb = this.spb(), now = this.ctx.currentTime
    const tracks = this.songTracks()
    const horizon = now + 0.15
    let from = this.schedBeat
    const to = (horizon - this.songT0) / spb
    if (to > from) {
      if (s.songOn === 'timeline') {
        for (const e of timelineEvents(tracks, from, to, this.firstWindow, spb)) this.fire(e, this.songT0 + e.beat * spb)
        this.firstWindow = false
        const end = songEnd(tracks)
        if (!this.tlRec && from > Math.max(end, s.pos) + tr.beats) { this.store.set({ pos: 0 }); this.songStop(); return }
      } else if (s.sceneOn) {
        let scene = s.sceneOn
        if (s.queuedScene) { // the queued scene starts on the next bar
          const bar = tr.beats, nb = Math.ceil(from / bar - 1e-9) * bar
          if (nb < to) {
            for (const e of sceneEvents(tracks, scene, this.sceneOrigin, sceneLen(tracks, scene, tr.beats), from, nb)) this.fire(e, this.songT0 + e.beat * spb)
            if (this.boardRec) this.closeBoardPass(this.songT0 + nb * spb, true)
            for (const p of this.performers.values()) p.panic(this.songT0 + nb * spb)
            this.sceneOrigin = nb
            scene = s.queuedScene
            from = nb
            this.store.set({ sceneOn: scene, queuedScene: null })
            if (s.songRec === 'board') this.openBoardPass(this.songT0 + nb * spb)
          }
        }
        for (const e of sceneEvents(tracks, scene, this.sceneOrigin, sceneLen(tracks, scene, tr.beats), from, to)) this.fire(e, this.songT0 + e.beat * spb)
      }
      this.schedBeat = to
    }
    if (tr.metronome || now < this.songT0 + this.schedBeatStart()) {
      for (const c of clicksIn(this.songT0, tr, Math.max(this.clickedTo, now), horizon)) this.click(c.t, c.accent)
    }
    this.clickedTo = horizon
    // a board recording pass ends where its loop does: its notes join the cell, the next pass records anew
    if (this.boardRec) {
      const pass = Math.floor(((now - this.songT0) / spb - this.sceneOrigin) / this.boardRec.len)
      if (pass > this.boardRec.pass) this.closeBoardPass(this.songT0 + (this.sceneOrigin + pass * this.boardRec.len) * spb, false)
    }
    const beat = Math.max(0, (now - this.songT0) / spb - (s.songOn === 'board' ? this.sceneOrigin : 0))
    this.clock.set({ beat })
  }
  private schedBeatStart() { return this.store.get().songOn === 'timeline' ? this.store.get().pos * this.spb() : 0 }

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

  // ---- recording into the selected track: a board cell (one pass at a time, overdubbing) or the timeline
  private recording() { return !!(this.boardRec || this.tlRec) }
  private recOn(n: number, vel: number, t: number) { this.boardRec?.rec.on(n, vel, t); this.tlRec?.rec.on(n, vel, t) }
  private recOff(n: number, t: number) { this.boardRec?.rec.off(n, t); this.tlRec?.rec.off(n, t) }

  /** Record into the selected track (` key): the board's playing scene, or the timeline from the playhead. */
  songRecord() {
    const s = this.store.get()
    if (s.songRec) { this.closeRecording(this.ctx.currentTime); this.store.set({ songRec: null }); return }
    const t = this.selected()
    if (!t || (t.kind !== 'instrument' && t.kind !== 'video')) { this.say('Select an instrument track to record into.'); return }
    if (s.view === 'board') {
      if (s.songOn !== 'board') this.songStart('board', s.transport.countIn)
      this.store.set({ songRec: 'board' })
      this.openBoardPass(Math.max(this.ctx.currentTime, this.songT0))
    } else {
      if (s.songOn !== 'timeline') this.songStart('timeline', s.transport.countIn)
      this.tlRec = { rec: new TimelineRecorder(this.songT0, this.store.get().transport), track: t.id }
      this.store.set({ songRec: 'timeline' })
    }
  }
  private openBoardPass(t: number) {
    const s = this.store.get(), scene = s.sceneOn
    const track = this.selected()
    if (!scene || !track) return
    const tr = s.transport, have = track.cells[scene]
    const len = have?.loop ?? loopBeats(tr)
    const spb = this.spb(), origin = this.songT0 + this.sceneOrigin * spb
    const pass = Math.max(0, Math.floor(((t - origin) / spb) / len))
    this.boardRec = { rec: new LayerRecorder(origin, { ...tr, bars: len / tr.beats }), pass, len, scene, track: track.id }
  }
  /** A pass ends: its notes join the cell (overdub), and the next pass starts unless the scene changed. */
  private closeBoardPass(t: number, last: boolean) {
    const r = this.boardRec
    if (!r) return
    const notes = r.rec.finish(t)
    if (notes.length) {
      const have = this.songTracks().find((x) => x.id === r.track)?.cells[r.scene]
      this.setCell(r.track, r.scene, have ? { ...have, notes: [...have.notes, ...notes].sort((a, b) => a.at - b.at) } : { id: uid('c'), start: 0, len: r.len, loop: r.len, notes })
    }
    if (last) { this.boardRec = null; return }
    const spb = this.spb(), origin = this.songT0 + this.sceneOrigin * spb, tr = this.store.get().transport
    this.boardRec = { ...r, rec: new LayerRecorder(origin, { ...tr, bars: r.len / tr.beats }), pass: Math.floor(((t - origin) / spb) / r.len + 1e-6) }
  }
  private closeRecording(t: number) {
    if (this.boardRec) this.closeBoardPass(t, true)
    if (this.tlRec) {
      const c = this.tlRec.rec.finish(t), id = this.tlRec.track
      this.tlRec = null
      if (c) this.store.set((s) => ({ tracks: s.tracks.map((x) => (x.id !== id ? x : { ...x, clips: [...x.clips.filter((o) => o.start < c.start || o.start + o.len > c.start + c.len), c].sort((a, b) => a.start - b.start) })) }))
    }
  }

  /** A video on a video or backing track: on the timeline at the playhead, and in the board's scene if its cell is empty. */
  private placeMedia(clip: Clip, track: Track, at: number) {
    const s = this.store.get(), spb = this.spb()
    const len = Math.max(s.transport.beats, Math.ceil(clip.duration / spb / s.transport.beats - 1e-9) * s.transport.beats)
    const exact = clip.duration / spb
    let sc: SongClip
    if (track.kind === 'backing') sc = { id: uid('c'), start: at, len, loop: len, notes: [], media: { clipId: clip.id, offset: 0 } }
    else {
      const home = homeKey({ ...track.inst.clip, clipId: clip.id }, clip)
      sc = { id: uid('c'), start: at, len, loop: len, notes: [{ at: 0, len: exact, note: home, vel: 100 }] }
    }
    const scene = s.sceneOn ?? s.scenes[0]?.id
    this.store.set((x) => ({ tracks: x.tracks.map((t) => {
      if (t.id !== track.id) return t
      const cells = scene && !t.cells[scene] ? { ...t.cells, [scene]: { ...sc, id: uid('c'), start: 0 } } : t.cells
      return { ...t, cells, clips: [...t.clips.filter((o) => o.start + o.len <= at || o.start >= at + len), sc].sort((a, b) => a.start - b.start) }
    }) }))
  }

  /** The song's beat at audio time t (negative during a count-in). */
  beatAt(t: number) { return (t - this.songT0) / this.spb() }

  /**
   * A take filmed along the song (the Jacob Collier split-screen, ADR 0773): it lands on its own video
   * track at the beat the camera started, the count-in trimmed off the front. Each take its own tile.
   */
  async addRecording(file: File, startBeat: number) {
    let t = this.selected()
    if (!t || t.kind !== 'video' || t.inst.clip.clipId) t = this.addTrack('video')
    const pre = Math.max(0, -startBeat) * this.spb()
    await this.importFiles([file], { track: t.id, at: Math.max(0, startBeat) })
    const id = this.store.get().clip.clipId, clip = id ? this.clips.get(id) : undefined
    if (clip && pre > 0) this.setClip({ start: Math.min(0.9, pre / clip.duration) })
  }

  /** A picture cue (layout or look) on a picture track at the playhead. */
  addCue(track: string, cue: { layout?: LayoutMode; look?: string }, at = this.store.get().pos) {
    const b = this.store.get().transport.beats
    const start = Math.floor(at / b) * b
    this.store.set((s) => ({ tracks: s.tracks.map((t) => (t.id !== track ? t : { ...t, clips: [...t.clips.filter((c) => c.start !== start), { id: uid('c'), start, len: b, loop: b, notes: [], cue }].sort((a, c) => a.start - c.start) })) }))
  }

  /** The timeline as one MP4: every track through its own instrument, the stage laid out by track. */
  async exportSong(opts: ExportOptions) {
    const s = this.store.get()
    const song = compileSong(this.songTracks(), s.transport)
    if (!song.events.length) { this.say('The timeline is empty: put a scene on it, or record into it, first.'); return }
    await this.export(opts, { name: 'Song', events: song.events, duration: song.duration })
  }

  // ---------- pads: note repeat, 16 Levels, multi-drop, swap and layer ---------------------------
  private repeaters = new Map<number, { notes: number[]; vel: number; next: number; k: number }>()
  private repeatTimer = 0

  setPadPlay(p: Partial<PadPlay>) { this.store.set((s) => ({ padPlay: { ...s.padPlay, ...p } })); if (p.repeat === false) this.repeaters.clear() }

  /** Note repeat: while a pad is held it retriggers on the grid (the loop's, if it runs), with swing. */
  private startRepeat(key: number, notes: number[], vel: number) {
    const s = this.store.get(), step = (s.padPlay.rate * 60) / s.transport.bpm, now = this.ctx.currentTime
    const first = s.songOn ? this.songT0 + Math.ceil((now + 0.01 - this.songT0) / step) * step : now + step
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
          if (this.recording()) { this.recOn(n, r.vel, r.next); this.recOff(n, r.next + len) }
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
      if (clip) events.unshift({ t: 0, ev: { type: 'main', clipId: clip.id, gain: this.mainOn.gain, offset: (got.start - this.mainOn.at) % clip.duration, place: 'behind' } })
    }
    const s = this.store.get()
    this.addTake({ name: `Capture ${new Date().toLocaleTimeString()}`, events, duration: takeDuration(events) })
    void s
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
      if (shifted.length) this.addTake({ name: `Take ${new Date().toLocaleTimeString()}`, events: shifted, duration: takeDuration(shifted) })
      this.store.set({ recording: false })
    } else {
      this.stopTake()
      this.rec = { start: this.ctx.currentTime, events: [] }
      if (this.mainOn) { // the bed is already playing: the take starts it where it is now
        const clip = this.clips.get(this.mainOn.clipId)
        if (clip) this.rec.events.push({ t: 0, ev: { type: 'main', clipId: clip.id, gain: this.mainOn.gain, offset: (this.ctx.currentTime - this.mainOn.at) % clip.duration, place: 'behind' } })
      }
      this.store.set({ recording: true })
    }
  }

  playTake() {
    const take = this.store.get().take
    if (!take || !this.base) return
    this.stopTake()
    void this.ctx.resume()
    this.replaying = true
    const start = this.ctx.currentTime + 0.15
    let i = 0
    this.store.set({ playing: true })
    this.playTimer = window.setInterval(() => {
      const horizon = this.ctx.currentTime + 0.12
      while (i < take.events.length && start + take.events[i].t <= horizon) { this.route(take.events[i].ev).play(take.events[i].ev, start + take.events[i].t); i++ }
      if (i >= take.events.length && this.ctx.currentTime > start + take.duration + 1) this.stopTake()
    }, 25)
  }

  stopTake() {
    if (!this.replaying) return
    clearInterval(this.playTimer)
    this.replaying = false
    this.panic()
    this.route({ type: 'main', clipId: null, gain: 0 }).play({ type: 'main', clipId: null, gain: 0 }, this.ctx.currentTime)
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

  /** A take (or the song, compiled) as an MP4: every note on its own track's instrument. */
  async export(opts: ExportOptions, what?: Take) {
    const s = this.store.get()
    const take = what ?? s.take
    if (!take || !this.stage || s.exporting) return
    this.stopTake()
    this.songStop()
    this.store.set({ exporting: { progress: 0, stage: 'Sound' } })
    try {
      const tracks = this.songTracks().filter((t) => t.kind === 'instrument' || t.kind === 'video')
        .map((t) => ({ id: t.id, state: { ...t.inst, bendRange: s.bendRange }, mix: this.mixOf(t.id), mode: !what ? opts.layout : t.kind === 'video' ? 'gallery' as const : s.layouts[t.inst.kind] }))
      const blob = await exportTake(take, {
        state: this.instrumentState(), clips: this.clips, levels: this.levels, stage: this.stage,
        homeCells: s.kind === 'pads' ? this.homeCells() : undefined, homeBase: this.bankBase(), fit: s.fit,
        fx: s.fx, bpm: s.transport.bpm, look: s.look, tracks, trackMode: opts.layout,
      }, opts, (progress, stage) => this.store.set({ exporting: { progress, stage } }))
      download(blob, `${take.name} ${opts.aspect.replace(':', 'x')}.mp4`)
    } catch (e) {
      this.say(`Export failed: ${(e as Error).message}`)
    } finally {
      this.stage.layout.reset()
      this.stage.inner.clear()
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
