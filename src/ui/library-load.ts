// The library's items for the window: what a drop on the stage reads, and how an item loads.
import { app } from '../engine/app'
import type { LibraryItem } from '../engine/library'

/** The library items, cached for the drop on the stage (it reads the dragged item's id). */
let known: LibraryItem[] = []
export const remember = (items: LibraryItem[]) => { known = items }
export const libraryItem = (id: string) => known.find((i) => i.id === id)

/** Load a library item into the selected track: onto the Clip, the selected pad, or as a new layer. */
export async function loadInto(i: LibraryItem) {
  const s = app.store.get()
  await app.loadItem(i, s.kind === 'pads' ? { pad: s.pads.selected } : undefined)
}
