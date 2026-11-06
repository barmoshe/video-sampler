// Inputs (design §8): the Mac keyboard first (ADR 0767), by physical key so the Hebrew layout plays
// the same notes, and Web MIDI as a robust MIDI 1.0 receiver.

/** Ableton's computer-keyboard layout: A..' = C..F of the current octave. */
export const NOTE_KEYS = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote']
export const KEY_LABEL: Record<string, string> = {
  KeyA: 'A', KeyW: 'W', KeyS: 'S', KeyE: 'E', KeyD: 'D', KeyF: 'F', KeyT: 'T', KeyG: 'G', KeyY: 'Y', KeyH: 'H',
  KeyU: 'U', KeyJ: 'J', KeyK: 'K', KeyO: 'O', KeyL: 'L', KeyP: 'P', Semicolon: ';', Quote: "'",
}
/** Pads mode: a 4×4 pad block, bottom row Z-V = the bank's first four pads. */
export const PAD_KEYS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'Digit1', 'Digit2', 'Digit3', 'Digit4']
export const PAD_LABEL = ['Z', 'X', 'C', 'V', 'A', 'S', 'D', 'F', 'Q', 'W', 'E', 'R', '1', '2', '3', '4']

export interface InputHandlers {
  noteOn(note: number, vel: number, timeStamp: number, source: 'keys' | 'midi'): void
  noteOff(note: number, timeStamp: number): void
  sustain(down: boolean, timeStamp: number): void
  bend(value: number, timeStamp: number): void // −1..1
  modWheel(value: number, timeStamp: number): void // 0..127
  bendRange(semitones: number): void
  panic(): void
  program(n: number): void
  transport(kind: 'start' | 'stop'): void
  clockBpm(bpm: number): void
}

export interface KeyContext {
  mode: 'notes' | 'pads'
  baseNote: () => number // the note A plays (notes mode) or the bank's first pad (pads mode)
  velocity: () => number
  octave(delta: number): void
  velocityStep(delta: number): void
  record(): void
}

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

export function attachKeyboard(h: InputHandlers, ctx: () => KeyContext): () => void {
  const down = new Map<string, number>() // code → note it started
  const onDown = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return
    const k = ctx()
    if (e.code === 'Enter') { k.record(); e.preventDefault(); return }
    if (e.code === 'Space') { h.sustain(true, e.timeStamp); e.preventDefault(); return }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { h.bend(e.code === 'ArrowUp' ? 1 : -1, e.timeStamp); e.preventDefault(); return }
    let note: number | null = null
    if (k.mode === 'pads') {
      const i = PAD_KEYS.indexOf(e.code)
      if (i >= 0) note = k.baseNote() + i
    } else {
      if (e.code === 'KeyZ') { k.octave(-1); return }
      if (e.code === 'KeyX') { k.octave(1); return }
      if (e.code === 'KeyC') { k.velocityStep(-20); return }
      if (e.code === 'KeyV') { k.velocityStep(20); return }
      const i = NOTE_KEYS.indexOf(e.code)
      if (i >= 0) note = k.baseNote() + i
    }
    if (note === null || note < 0 || note > 127) return
    e.preventDefault()
    down.set(e.code, note)
    h.noteOn(note, e.shiftKey ? 127 : k.velocity(), e.timeStamp, 'keys')
  }
  const onUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') { h.sustain(false, e.timeStamp); return }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { h.bend(0, e.timeStamp); return }
    const note = down.get(e.code)
    if (note === undefined) return
    down.delete(e.code)
    h.noteOff(note, e.timeStamp)
  }
  const onBlur = () => { for (const [code, note] of down) { h.noteOff(note, performance.now()); down.delete(code) } }
  addEventListener('keydown', onDown)
  addEventListener('keyup', onUp)
  addEventListener('blur', onBlur)
  return () => { removeEventListener('keydown', onDown); removeEventListener('keyup', onUp); removeEventListener('blur', onBlur) }
}

/** A MIDI 1.0 receiver: running-status-free Web MIDI messages, one per event. */
export class MidiReceiver {
  private rpn = [127, 127]
  private clocks: number[] = []
  private h: InputHandlers
  constructor(h: InputHandlers) { this.h = h }

  message(data: Uint8Array, ts: number) {
    const [st, d1 = 0, d2 = 0] = data
    if (st === 0xf8) { this.clock(ts); return }
    if (st === 0xfa || st === 0xfb) { this.h.transport('start'); return }
    if (st === 0xfc) { this.h.transport('stop'); return }
    const type = st & 0xf0
    if (type === 0x90 && d2 > 0) this.h.noteOn(d1, d2, ts, 'midi')
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) this.h.noteOff(d1, ts)
    else if (type === 0xe0) this.h.bend(((d2 << 7) | d1) / 8192 - 1, ts)
    else if (type === 0xc0) this.h.program(d1)
    else if (type === 0xb0) this.cc(d1, d2, ts)
  }

  private cc(n: number, v: number, ts: number) {
    if (n === 64) this.h.sustain(v >= 64, ts)
    else if (n === 1) this.h.modWheel(v, ts)
    else if (n === 101) this.rpn[0] = v
    else if (n === 100) this.rpn[1] = v
    else if (n === 6 && this.rpn[0] === 0 && this.rpn[1] === 0) this.h.bendRange(v) // RPN 0: bend sensitivity
    else if (n === 120 || n === 123) this.h.panic()
  }

  private clock(ts: number) {
    this.clocks.push(ts)
    if (this.clocks.length > 48) this.clocks.shift()
    if (this.clocks.length === 48) {
      const beat = ((this.clocks[47] - this.clocks[0]) / 47) * 24
      if (beat > 0) this.h.clockBpm(Math.round(60000 / beat))
    }
  }
}

export async function connectMidi(rx: MidiReceiver, onDevices: (names: string[]) => void): Promise<void> {
  if (!('requestMIDIAccess' in navigator)) throw new Error('This browser has no Web MIDI (Safari). Use Chrome, or play with the keyboard.')
  const access = await navigator.requestMIDIAccess()
  const wire = () => {
    const names: string[] = []
    access.inputs.forEach((inp) => {
      names.push(inp.name ?? 'MIDI input')
      inp.onmidimessage = (e) => { if (e.data) rx.message(e.data, e.timeStamp) }
    })
    onDevices(names)
  }
  access.onstatechange = wire
  wire()
}
