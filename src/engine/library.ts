// The bundled pack (ADR 0770): public/library/manifest.json, made by tools/library/.
/** One clip of the bundled pack (public/library/manifest.json, made by tools/library/, ADR 0770). */
export interface LibraryItem {
  id: string
  name: string
  kind: 'pitched' | 'drum' | 'loop' | 'video'
  file: string
  poster: string
  duration: number
  credits?: { license?: string; author?: string; url?: string }
}

export async function loadManifest(): Promise<LibraryItem[]> {
  const res = await fetch('/library/manifest.json', { cache: 'no-cache' })
  if (!res.ok) return []
  const m = await res.json()
  return (Array.isArray(m) ? m : m.items ?? m.clips ?? []) as LibraryItem[]
}


/** A pack item as a File, ready for importFiles (the same path a dropped video takes). */
export async function fileOf(item: LibraryItem): Promise<File> {
  const res = await fetch(`/library/${item.file}`)
  if (!res.ok) throw new Error(`${item.name}: ${res.status}`)
  return new File([await res.blob()], `${item.name}.mp4`, { type: 'video/mp4' })
}
