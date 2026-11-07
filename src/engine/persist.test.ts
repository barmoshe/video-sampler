import { describe, expect, it } from 'vitest'
import { packProject, unpackProject, type SavedProject } from './persist'

describe('the project file', () => {
  it('packs the document and each clip, and unpacks them back the same', async () => {
    const p: SavedProject = { v: 1, savedAt: 1, clips: [{ id: 'c1', name: 'a', file: 'h.mp4' }, { id: 'c2', name: 'b', file: 'g.webm' }], doc: { kind: 'pads', fx: { glue: 0.3 } } }
    const files = new Map([['c1', new File([new Uint8Array([1, 2, 3])], 'a.mp4', { type: 'video/mp4' })], ['c2', new File(['hello'], 'b.webm', { type: 'video/webm' })]])
    const back = await unpackProject(await packProject(p, files))
    expect(back.project).toEqual(p)
    expect([...new Uint8Array(await back.files.get('c1')!.arrayBuffer())]).toEqual([1, 2, 3])
    expect(await back.files.get('c2')!.text()).toBe('hello')
    expect(back.files.get('c2')!.type).toBe('video/webm')
  })
  it('refuses a file that is not a project', async () => {
    await expect(unpackProject(new Blob(['not a project']))).rejects.toThrow(/not a video sampler project/)
  })
})
