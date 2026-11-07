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

// ---------- the project file (.vsamp): one file to keep, move or share a project ----------------
// Layout: "VSAMP1\n", a 4-byte little-endian header length, the header (JSON: the project and an
// entry per clip), then each clip's original bytes in the header's order.

const MAGIC = 'VSAMP1\n'
interface PackEntry { id: string; name: string; file: string; type: string; size: number }

export async function packProject(p: SavedProject, files: Map<string, File>): Promise<Blob> {
  const entries: PackEntry[] = p.clips.flatMap((c) => { const f = files.get(c.id); return f ? [{ id: c.id, name: c.name, file: c.file, type: f.type, size: f.size }] : [] })
  const head = new TextEncoder().encode(JSON.stringify({ project: p, entries }))
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, head.length, true)
  return new Blob([MAGIC, len, head, ...entries.map((e) => files.get(e.id)!)], { type: 'application/octet-stream' })
}

export async function unpackProject(b: Blob): Promise<{ project: SavedProject; files: Map<string, File> }> {
  const magic = await b.slice(0, MAGIC.length).text()
  if (magic !== MAGIC) throw new Error('This is not a video sampler project file.')
  const len = new DataView(await b.slice(MAGIC.length, MAGIC.length + 4).arrayBuffer()).getUint32(0, true)
  let at = MAGIC.length + 4
  const { project, entries } = JSON.parse(await b.slice(at, at + len).text()) as { project: SavedProject; entries: PackEntry[] }
  at += len
  const files = new Map<string, File>()
  for (const e of entries) { files.set(e.id, new File([b.slice(at, at + e.size)], e.name, { type: e.type })); at += e.size }
  if (project.v !== 1) throw new Error('This project file is from a newer version.')
  return { project, files }
}
