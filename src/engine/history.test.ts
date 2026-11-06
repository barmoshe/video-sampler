import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { History } from './history'

describe('undo and redo by snapshots', () => {
  let doc = { cutoff: 1000, name: 'a' }
  const make = () => new History(() => doc, (d) => { doc = d }, 400)
  beforeEach(() => { vi.useFakeTimers(); doc = { cutoff: 1000, name: 'a' } })
  afterEach(() => vi.useRealTimers())

  it('a burst of changes (a slider drag) is one step', () => {
    const h = make(); h.reset()
    for (const c of [900, 800, 700]) { doc = { ...doc, cutoff: c }; h.changed(); vi.advanceTimersByTime(100) }
    vi.advanceTimersByTime(500)
    expect(h.undo()).toBe(true)
    expect(doc.cutoff).toBe(1000)
    expect(h.undo()).toBe(false)
  })
  it('redo brings it back; a new edit clears the redo', () => {
    const h = make(); h.reset()
    doc = { ...doc, cutoff: 500 }; h.changed(); vi.advanceTimersByTime(500)
    h.undo(); expect(doc.cutoff).toBe(1000)
    h.redo(); expect(doc.cutoff).toBe(500)
    h.undo(); doc = { ...doc, name: 'b' }; h.changed(); vi.advanceTimersByTime(500)
    expect(h.canRedo).toBe(false)
  })
  it('an edit still settling is undone at once', () => {
    const h = make(); h.reset()
    doc = { ...doc, cutoff: 300 }; h.changed() // no wait
    expect(h.undo()).toBe(true)
    expect(doc.cutoff).toBe(1000)
  })
  it('applying a step does not record a new one', () => {
    const h = make(); h.reset()
    doc = { ...doc, cutoff: 200 }; h.changed(); vi.advanceTimersByTime(500)
    h.undo(); h.changed(); vi.advanceTimersByTime(500) // the store fires after apply
    expect(h.canRedo).toBe(true)
  })
})
