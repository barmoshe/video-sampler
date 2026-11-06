#!/usr/bin/env node
// Downloads and prepares the pack's audio (pack.json): one VCSL (CC0) file per sound, trimmed to its
// first sound, cut to `max` seconds with a short fade, levelled to a −1 dBFS peak, 48 kHz stereo WAV.
// Raw downloads land in assets-src/raw/ (git-ignored, untouched data); results in assets-src/audio/.
// Also writes assets-src/audio/credits.json (source URL, path, licence) for the credits page.
//   node tools/library/source-audio.mjs [--only id,id]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'))
const RAW = join(root, 'assets-src/raw'), OUT = join(root, 'assets-src/audio')
mkdirSync(RAW, { recursive: true }); mkdirSync(OUT, { recursive: true })
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null

const { repo, branch } = pack.source
const treeFile = join(RAW, 'tree.json')
if (!existsSync(treeFile)) {
  const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, { headers: { 'User-Agent': 'video-sampler-pack' } })
  if (!res.ok) throw new Error(`tree: ${res.status}`)
  writeFileSync(treeFile, await res.text())
}
const paths = JSON.parse(readFileSync(treeFile, 'utf8')).tree.filter((t) => t.type === 'blob').map((t) => t.path)

const credits = []
for (const s of pack.sounds) {
  if (only && !only.includes(s.id)) continue
  const re = new RegExp(s.match)
  const path = paths.find((p) => re.test(p))
  if (!path) { console.log(`MISS ${s.id}: no file matches ${s.match}`); continue }
  const raw = join(RAW, `${s.id}.wav`)
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`
  if (!existsSync(raw)) {
    const res = await fetch(url)
    if (!res.ok) { console.log(`FAIL ${s.id}: ${res.status}`); continue }
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()))
  }
  // 1) trim to the first sound and cut to length; 2) measure the peak; 3) level it to −1 dBFS
  const tmp = join(OUT, `${s.id}.tmp.wav`), out = join(OUT, `${s.id}.wav`)
  const fade = Math.min(0.25, s.max * 0.2)
  const cut = (trim) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af',
    `${trim ? 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.002,' : ''}atrim=0:${s.max},afade=t=out:st=${(s.max - fade).toFixed(3)}:d=${fade.toFixed(3)}`,
    '-ar', '48000', '-ac', '2', tmp])
  const peakOf = () => execFileSync('sh', ['-c', `ffmpeg -v info -i "${tmp}" -af volumedetect -f null - 2>&1 | grep max_volume || true`], { encoding: 'utf8' })
  cut(true)
  let log = peakOf()
  if (!/max_volume/.test(log)) { cut(false); log = peakOf() } // the trim found no start: keep the file's own start
  const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(log)?.[1] ?? 0)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-af', `volume=${(-1 - peak).toFixed(2)}dB`, '-c:a', 'pcm_s24le', out])
  execFileSync('rm', ['-f', tmp])
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }))
  credits.push({ id: s.id, name: s.name, kind: s.kind, path, url, license: pack.source.license, author: 'VCSL contributors (Sam Gossner et al.)', duration: Number(dur.toFixed(3)), gainDb: Number((-1 - peak).toFixed(2)) })
  console.log(`OK   ${s.id.padEnd(13)} ${dur.toFixed(2)} s  ${path}`)
}
writeFileSync(join(OUT, 'credits.json'), JSON.stringify(credits, null, 2))
console.log(`${credits.length} / ${pack.sounds.length} sounds ready in assets-src/audio/`)
