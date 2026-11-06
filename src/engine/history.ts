// Undo and redo (production.md §3 J) by snapshots of the project document: every edit is a change to
// one JSON-able document, bursts (a slider drag) settle into one step, and undo puts the document
// back. Clips are not in the document (undo never re-imports or frees a clip).

export class History<D> {
  private past: string[] = []
  private future: string[] = []
  private last: string | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private take: () => D
  private apply: (d: D) => void
  private wait: number
  private cap: number

  constructor(take: () => D, apply: (d: D) => void, wait = 400, cap = 200) {
    this.take = take
    this.apply = apply
    this.wait = wait
    this.cap = cap
  }

  /** The document as it is now becomes the base (after a load or a restore). */
  reset() { clearTimeout(this.timer); this.past = []; this.future = []; this.last = JSON.stringify(this.take()) }

  /** Call on every change; a burst settles into one step after `wait` ms. */
  changed() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.commit(), this.wait)
  }

  /** Record the current document as a step if it differs from the last one. */
  commit() {
    clearTimeout(this.timer)
    const now = JSON.stringify(this.take())
    if (now === this.last) return
    if (this.last !== null) {
      this.past.push(this.last)
      if (this.past.length > this.cap) this.past.shift()
    }
    this.future = []
    this.last = now
  }

  get canUndo() { return this.past.length > 0 || (this.last !== null && JSON.stringify(this.take()) !== this.last) }
  get canRedo() { return this.future.length > 0 }

  undo() {
    this.commit()
    const prev = this.past.pop()
    if (prev === undefined || this.last === null) return false
    this.future.push(this.last)
    this.last = prev
    this.apply(JSON.parse(prev) as D)
    return true
  }

  redo() {
    this.commit()
    const next = this.future.pop()
    if (next === undefined || this.last === null) return false
    this.past.push(this.last)
    this.last = next
    this.apply(JSON.parse(next) as D)
    return true
  }
}
