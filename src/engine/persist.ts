// Autosave and restore (production.md §3 J). The browser's private file system (OPFS) holds each
// clip's original file once, named by a hash of its bytes, and project.json holds the document
// (every setting, layer, section and take, with clip ids). Storage is best-effort until
// navigator.storage.persist() is granted, and "clear browsing data" removes it, so a project file
// to download stays the way to keep work (research pass 3 §4).

export interface SavedClip { id: string; name: string; file: string }
export interface SavedProject<D = Record<string, unknown>> { v: 1; savedAt: number; clips: SavedClip[]; doc: D }

const DIR = 'video-sampler', PROJECT = 'project.json'

export const canPersist = () => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory

async function folder(sub?: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  const d = await root.getDirectoryHandle(DIR, { create: true })
  return sub ? d.getDirectoryHandle(sub, { create: true }) : d
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string) {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(data)
  await w.close()
}

async function hash(b: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await b.arrayBuffer())
  return [...new Uint8Array(d).slice(0, 12)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Store a clip's original file once (by content); returns its name in the clips folder. */
export async function saveClipFile(file: Blob, name: string): Promise<string> {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] ?? 'bin').toLowerCase()
  const fname = `${await hash(file)}.${ext}`
  const dir = await folder('clips')
  try { await dir.getFileHandle(fname); return fname } catch { /* not there yet */ }
  await writeFile(dir, fname, file)
  return fname
}

export async function readClipFile(fname: string, name: string): Promise<File | null> {
  try {
    const f = await (await (await folder('clips')).getFileHandle(fname)).getFile()
    return new File([f], name, { type: f.type })
  } catch { return null }
}

export async function saveProject(p: SavedProject): Promise<void> {
  await writeFile(await folder(), PROJECT, JSON.stringify(p))
}

export async function loadProject(): Promise<SavedProject | null> {
  try {
    const f = await (await (await folder()).getFileHandle(PROJECT)).getFile()
    const p = JSON.parse(await f.text()) as SavedProject
    return p.v === 1 ? p : null
  } catch { return null }
}

/** Forget the saved project and its clip files (a new, empty project). */
export async function clearProject(): Promise<void> {
  const root = await navigator.storage.getDirectory()
  try { await root.removeEntry(DIR, { recursive: true }) } catch { /* nothing saved */ }
}

/** Ask the browser to keep this site's storage (Chromium and Safari decide silently, Firefox asks). */
export async function askToKeep(): Promise<boolean> {
  try { return (await navigator.storage.persisted()) || (await navigator.storage.persist()) } catch { return false }
}
