import { describe, expect, it } from 'vitest'
import { gallery, LayoutEngine, treemap } from './layout'

describe('gallery', () => {
  it('fills a 16:9 stage with one full tile', () => {
    expect(gallery(1, 1920, 1080, 16 / 9)[0]).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })
  it('makes quadrants for four voices', () => {
    const r = gallery(4, 1920, 1080, 16 / 9)
    expect(r.every((t) => Math.abs(t.w - 960) < 1e-6)).toBe(true)
  })
  it('fits 128 voices in an 11-12 column grid (math §4.1)', () => {
    const r = gallery(128, 1920, 1080, 16 / 9)
    const cols = new Set(r.map((t) => Math.round(t.x))).size
    expect(cols).toBeGreaterThanOrEqual(11)
    expect(cols).toBeLessThanOrEqual(12)
  })
})

describe('treemap', () => {
  it('gives area in proportion to weight and covers the stage', () => {
    const r = treemap([3, 1, 1, 1], 400, 300)
    const areas = r.map((t) => t.w * t.h)
    expect(areas.reduce((a, b) => a + b, 0)).toBeCloseTo(120000)
    expect(areas[0] / areas[1]).toBeCloseTo(3)
  })
})

describe('layout stability (math §4.3)', () => {
  const cell = (key: string, order: number) => ({ key, order, weight: 1, born: 0 })
  it('places a new note at once and keeps a released one until the re-flow', () => {
    const L = new LayoutEngine()
    let r = L.update('gallery', [cell('a', 60)], 1600, 900, 16 / 9, 0, 1 / 60)
    expect(r.get('a')!.w).toBeCloseTo(1600)
    r = L.update('gallery', [cell('a', 60), cell('b', 64)], 1600, 900, 16 / 9, 0.1, 1 / 60)
    expect(r.has('b')).toBe(true)
    // 'b' leaves: 'a' does not jump back to full screen before 120 ms
    r = L.update('gallery', [cell('a', 60)], 1600, 900, 16 / 9, 0.2, 1 / 60)
    expect(r.get('a')!.w).toBeLessThan(1600)
  })
  it('does not shrink the grid during a fast trill (Schmitt trigger)', () => {
    const L = new LayoutEngine()
    let t = 0
    const widths: number[] = []
    for (let k = 0; k < 20; k++) {
      t += 0.05
      const cells = k % 2 ? [cell('a', 60), cell('b', 62)] : [cell('a', 60)]
      const r = L.update('gallery', cells, 1600, 900, 16 / 9, t, 0.05)
      widths.push(Math.round(r.get('a')!.w))
    }
    // after the springs settle (70 ms half-life), 'a' keeps its half-width cell through the trill
    const settled = widths.slice(10)
    expect(Math.max(...settled) - Math.min(...settled)).toBeLessThan(2)
    expect(settled[0]).toBeLessThan(1000)
  })
})
