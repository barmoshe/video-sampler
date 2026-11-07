// End-to-end check in headless Chrome over DevTools (no dependencies): load clips, play, switch
// layouts and instruments, record with the fake camera, record a take, export an MP4.
//   npm run build && node tools/check.mjs [--media dir]
// Writes screenshots and the exported MP4 to tools/out/ and prints a pass / fail line per step.
import { spawn, execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DIST = resolve('dist'), OUT = resolve('tools/out')
const mi = process.argv.indexOf('--media')
const MEDIA = resolve(mi > 0 ? process.argv[mi + 1] : '../bar_builds/lab/video-sampler/spike/media')
const W = 1470, H = 832 // the workshop's test viewport (13" MacBook)
mkdirSync(OUT, { recursive: true })
for (const f of readdirSync(OUT)) rmSync(join(OUT, f), { recursive: true, force: true })

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.json': 'application/json', '.md': 'text/markdown' }
const server = createServer((req, res) => {
  let p = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' })
  createReadStream(p).pipe(res)
}).listen(0, '127.0.0.1')
await once(server, 'listening')
const ui = process.argv.indexOf('--url') // check a deployment instead of the local dist/
const base = ui > 0 ? process.argv[ui + 1].replace(/\/$/, '') : `http://127.0.0.1:${server.address().port}`

const profile = mkdtempSync(join(tmpdir(), 'vs-check-'))
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization', `--window-size=${W},${H}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
const wsUrl = await new Promise((ok, fail) => {
  let buf = ''
  proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]) })
  setTimeout(() => fail(new Error('no DevTools')), 20000)
})
const ws = new WebSocket(wsUrl)
await new Promise((ok) => (ws.onopen = ok))
let id = 0
const pending = new Map(), logs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { ok, fail } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) fail(new Error(m.error.message))
    else ok(m.result)
  }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text))
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description).join(' '))
}
const send = (method, params = {}, sessionId) => new Promise((ok, fail) => { const i = ++id; pending.set(i, { ok, fail }); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const page = (m, p) => send(m, p, sessionId)
await page('Runtime.enable'); await page('Page.enable'); await page('DOM.enable')
await page('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true })

const evaluate = async (expr) => {
  const r = await page('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (expr, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evaluate(expr)) return true; await sleep(200) } throw new Error('timeout: ' + expr) }
const shot = async (name) => { const { data } = await page('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name), Buffer.from(data, 'base64')) }
const key = async (code, type) => page('Input.dispatchKeyEvent', { type, code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : 0 })
const chord = async (codes, holdMs) => { for (const c of codes) await key(c, 'keyDown'); await sleep(holdMs); for (const c of codes) await key(c, 'keyUp') }
const setFiles = async (paths) => {
  const { root } = await page('DOM.getDocument', {})
  const { nodeId } = await page('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
  await page('DOM.setFileInputFiles', { nodeId, files: paths })
}
const results = []
const oi = process.argv.indexOf('--only') // --only "import a clip,sample editor": run just the steps whose names contain these
const ONLY = oi > 0 ? process.argv[oi + 1].split(',').map((x) => x.trim()) : null
const step = async (name, fn) => {
  if (ONLY && !ONLY.some((o) => name.includes(o))) return
  try { const note = await fn(); results.push({ name, ok: true, note }); console.log(`PASS ${name}${note ? `  (${note})` : ''}`) }
  catch (e) { results.push({ name, ok: false, note: String(e.message ?? e) }); console.log(`FAIL ${name}  ${e.message ?? e}`) }
}
const S = (expr) => evaluate(`(() => { const s = window.__vs.store.get(); return ${expr} })()`)

try {
  await page('Page.navigate', { url: base })
  await until('!!window.__vs && !!window.__vs.stage && !!window.__vs.performer')
  await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 300, button: 'left', clickCount: 1 })
  await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: 300, button: 'left', clickCount: 1 })
  const click = (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('nothing matches ' + ${JSON.stringify(JSON.stringify(sel))}); e.click(); return true })()`)
  const clearClips = () => evaluate('for (const c of [...window.__vs.store.get().clips]) window.__vs.removeClip(c.id)')

  await step('first visit: an instrument that is on (the pack\'s marimba on the Clip)', async () => {
    const t0 = Date.now()
    await until("window.__vs.store.get().clips.length === 1 && !window.__vs.store.get().starting", 60000)
    const r = await S('`${s.clips[0].name}, root ${s.clips[0].root.toFixed(2)}, home key ${s.octave >= 0 ? "+" : ""}${s.octave} octave`')
    await evaluate('window.__vs.handlers.noteOn(60, 100, performance.now(), "keys"); window.__vs.handlers.noteOn(64, 100, performance.now(), "keys"); window.__vs.handlers.noteOn(67, 100, performance.now(), "keys")')
    await until('window.__vs.store.get().voices >= 3', 3000).catch(() => {}) // the count reaches the store a frame or two after the tiles
    const voices = await S('s.voices')
    await shot('01-first-visit.png')
    await evaluate('for (const n of [60, 64, 67]) window.__vs.handlers.noteOff(n, performance.now())')
    if ((await S('s.clips[0].name')) !== 'Marimba' || voices < 3) throw new Error(`${r}, ${voices} on stage`)
    return `${((Date.now() - t0) / 1000).toFixed(1)} s to load; ${r}; a C major chord puts ${voices} tiles on stage`
  })
  await step('pads: an empty kit fills itself with the pack\'s drums', async () => {
    await click('.instruments button:nth-child(3)') // Pads (the legend is the first child)
    await until('window.__vs.store.get().pads.chains.filter((c) => c.clipId).length >= 15', 300000) // fifteen imports: slow on a loaded machine
    const n = await S('s.pads.chains.filter((c) => c.clipId).length')
    await evaluate('window.__vs.handlers.noteOn(36, 110, performance.now(), "keys"); window.__vs.handlers.noteOn(38, 100, performance.now(), "keys")')
    await sleep(300)
    await shot('02-pads-kit.png')
    await evaluate('window.__vs.handlers.noteOff(36, performance.now()); window.__vs.handlers.noteOff(38, performance.now())')
    const names = await S('s.pads.chains.slice(0, 4).map((c) => s.clips.find((x) => x.id === c.clipId)?.name).join(", ")')
    return `${n} pads loaded (${names}, …)`
  })
  await step('the inspector\'s knobs follow the selection: Cutoff turned there closes a low-pass, the value pops up', async () => {
    await click('.instruments button:nth-child(2)') // Clip
    await sleep(200)
    const before = await S('`${s.clip.filter.type} ${Math.round(s.clip.filter.cutoff)}`')
    const ok = await evaluate(`(() => {
      const slot = [...document.querySelectorAll('.knobs .kslot')].find((k) => k.textContent.includes('Cutoff'))
      const input = slot?.querySelector('input[type=range]')
      if (!input) return false
      input.focus()
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(input, String(Number(input.value) - 250))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await sleep(150)
    const hud = await evaluate("document.querySelector('.hud')?.textContent ?? ''")
    await shot('03-knob-hud.png')
    const after = await S('`${s.clip.filter.type} ${Math.round(s.clip.filter.cutoff)}`')
    await evaluate("window.__vs.setClip({ filter: { ...window.__vs.store.get().clip.filter, type: 'off' } })")
    if (!ok || !after.startsWith('lp') || !hud.includes('Cutoff')) throw new Error(`before ${before}, after ${after}, hud "${hud}"`)
    return `filter ${before} → ${after}; the stage showed "${hud}"`
  })
  await until('!window.__vs.store.get().importing', 300000).catch(() => {}) // the kit's last import, before the clips go
  await sleep(500)
  await clearClips()
  await evaluate("window.__vs.setPads({ chains: [] })")

  await step('import a clip (30 s 1080p, frame barcode)', async () => {
    const t0 = Date.now()
    await setFiles([join(MEDIA, 'clip30.mp4')])
    await until('window.__vs.store.get().clips.length === 1', 180000)
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    // every cached layer must hold its own frame: read the clip's 16-bit barcode (64 px per bit, top-left)
    const bad = await evaluate(`(() => {
      const app = window.__vs, gl = app.stage.gl, cf = app.stage.cache.clips.get(app.store.get().clips[0].id)
      let bad = 0
      for (const arr of [cf.S, cf.M].filter(Boolean)) {
        const fb = gl.createFramebuffer(), px = new Uint8Array(arr.w * 4), sc = arr.w / 1920, y = Math.round(32 * sc)
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
        for (let l = 0; l < arr.layers; l++) {
          gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, arr.tex, 0, l)
          gl.readPixels(0, y, arr.w, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
          let v = 0
          for (let k = 0; k < 16; k++) if (px[Math.round((64 * k + 32) * sc) * 4] > 128) v |= 1 << k
          if (v !== l) bad++
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb)
      }
      return bad
    })()`)
    if (bad) throw new Error(`${bad} layers hold the wrong frame`)
    await sleep(400)
    await shot('01b-loaded.png')
    return `${secs} s to load, every layer its own frame; ` + await S('`${s.clips[0].frames} frames, root ${s.clips[0].root.toFixed(2)}, ${s.clips[0].onsets.length} onsets, ${s.clips[0].cuts.length} cuts, ${s.clips[0].loudness.toFixed(1)} LUFS`')
  })
  await step('a phone-style rotated clip (stored sideways, flagged 90°) stands upright', async () => {
    await setFiles([join(MEDIA, 'rot90.mp4')])
    await until('window.__vs.store.get().clips.length === 2', 60000)
    const info = await S('`display ${s.clips[1].width}×${s.clips[1].height}`')
    const rot = await evaluate(`window.__vs.stage.cache.clips.get(window.__vs.store.get().clips[1].id).rotation`)
    await evaluate(`window.__vs.setClip({ clipId: window.__vs.store.get().clips[1].id })`)
    await evaluate('window.__vs.handlers.noteOn(60, 110, performance.now(), "keys")')
    await sleep(500)
    await shot('01c-rotated.png')
    await evaluate('window.__vs.handlers.noteOff(60, performance.now())')
    await evaluate(`window.__vs.setClip({ clipId: window.__vs.store.get().clips[0].id })`)
    await sleep(500)
    return `${info}, cached with a ${rot}° shader turn`
  })
  await step('a chord from the keyboard shows three tiles', async () => {
    for (const c of ['KeyA', 'KeyD', 'KeyG']) await key(c, 'keyDown')
    await sleep(600)
    const n = await S('s.voices')
    await shot('02-chord-gallery.png')
    for (const c of ['KeyA', 'KeyD', 'KeyG']) await key(c, 'keyUp')
    if (n !== 3) throw new Error(`${n} tiles`)
    return `${n} tiles`
  })
  await step('tune: the keyboard follows the clip to its home key (A2 → octave −1)', async () => {
    const r = await S('`octave ${s.octave}, tune ${s.clip.tune}, root ${s.clips[0].root.toFixed(2)}`')
    if ((await S('s.octave')) !== -1) throw new Error(r)
    return r
  })
  await step('scale lock + triads: one key plays a chord in key', async () => {
    await evaluate("window.__vs.setScale({ lock: true, tonic: 0, scale: 'major', chord: 'triad' })")
    await key('KeyS', 'keyDown') // the 2nd degree: D minor in C major
    await sleep(500)
    const n = await S('s.voices'), act = await S('JSON.stringify(s.active)')
    await shot('02b-scale-chord.png')
    await key('KeyS', 'keyUp')
    await evaluate("window.__vs.setScale({ lock: false, chord: 'off' })")
    await sleep(300)
    if (n !== 3 || act !== '[50,53,57]') throw new Error(`${n} tiles, ${act}`)
    return `${n} tiles, notes ${act} (D2 F2 A2)`
  })
  await step('filter: a closed low-pass with resonance and an LFO plays, and the tiles blur', async () => {
    await evaluate("window.__vs.setClip({ filter: { ...window.__vs.store.get().clip.filter, type: 'lp', cutoff: 300, res: 0.6 }, lfo: { ...window.__vs.store.get().clip.lfo, filter: 1, volume: 0.3 } })")
    for (const c of ['KeyA', 'KeyG']) await key(c, 'keyDown')
    await sleep(500)
    const n = await S('s.voices')
    await shot('02c-filter-blur.png')
    for (const c of ['KeyA', 'KeyG']) await key(c, 'keyUp')
    await evaluate("window.__vs.setClip({ filter: { ...window.__vs.store.get().clip.filter, type: 'off', res: 0.15 }, lfo: { ...window.__vs.store.get().clip.lfo, filter: 0, volume: 0 } })")
    await sleep(300)
    if (n !== 2) throw new Error(`${n} tiles`)
    return `${n} tiles through a 300 Hz low-pass`
  })
  for (const mode of ['keys', 'stack', 'mosaic', 'spotlight']) {
    await step(`layout ${mode}`, async () => {
      await evaluate(`window.__vs.setLayout('${mode}')`)
      for (const c of ['KeyA', 'KeyE', 'KeyG', 'KeyK']) await key(c, 'keyDown')
      await sleep(500)
      await shot(`03-${mode}.png`)
      for (const c of ['KeyA', 'KeyE', 'KeyG', 'KeyK']) await key(c, 'keyUp')
      return `${await S('s.voices')} tiles`
    })
  }
  await evaluate("window.__vs.setLayout('gallery')")
  await step('16 voices at once', async () => {
    await evaluate('for (let n = 48; n < 64; n++) window.__vs.handlers.noteOn(n, 100, performance.now(), "keys")')
    await sleep(500)
    await shot('04-sixteen.png')
    const n = await S('s.voices')
    await evaluate('for (let n = 48; n < 64; n++) window.__vs.handlers.noteOff(n, performance.now())')
    if (n !== 16) throw new Error(`${n} tiles`)
    return `${n} tiles`
  })
  await step('one-shot, slice and reverse modes play', async () => {
    const out = []
    for (const p of [{ mode: 'oneshot' }, { mode: 'slice', sliceBy: 'cut' }, { mode: 'slice', sliceBy: 'region', sliceRegions: 8 }, { mode: 'classic', reverse: true }]) {
      await evaluate(`window.__vs.setClip(${JSON.stringify(p)})`)
      await evaluate('window.__vs.handlers.noteOn(36, 100, performance.now(), "keys"); window.__vs.handlers.noteOn(60, 100, performance.now(), "keys")')
      await sleep(300)
      out.push(await S('s.voices'))
      await evaluate('window.__vs.handlers.noteOff(36, performance.now()); window.__vs.handlers.noteOff(60, performance.now()); window.__vs.panic()')
      await sleep(150)
    }
    await evaluate("window.__vs.setClip({ mode: 'classic', reverse: false })")
    if (out.some((n) => n < 1)) throw new Error(`tiles per mode ${out}`)
    return `tiles per mode ${out.join(', ')}`
  })
  await step('record a take', async () => {
    await evaluate('window.__vs.toggleRecord()')
    for (const c of ['KeyA', 'KeyD', 'KeyG', 'KeyK', 'KeyG', 'KeyD']) await chord([c], 220)
    await chord(['KeyA', 'KeyD', 'KeyG'], 500)
    await evaluate('window.__vs.toggleRecord()')
    const notes = await S("s.take ? s.take.events.filter((e) => e.ev.type === 'on').length : 0")
    if (notes !== 9) throw new Error(`${notes} notes recorded`)
    return `${notes} notes, ${await S('s.take.duration.toFixed(2)')} s`
  })
  await step('play the take back', async () => {
    await evaluate('window.__vs.playTake()')
    await sleep(700)
    const n = await S('s.voices')
    await shot('05-take-playback.png')
    await until('!window.__vs.store.get().playing', 10000)
    if (n < 1) throw new Error('nothing on stage during playback')
    return `${n} tiles mid-take`
  })
  await step('export the take as 9:16 MP4 (re-laid out after the take)', async () => {
    await evaluate("window.__vs.export({ aspect: '9:16', layout: 'mosaic', height: 720, fps: 30 })")
    await sleep(500)
    await until('!window.__vs.store.get().exporting', 180000)
    const f = readdirSync(OUT).find((x) => x.endsWith('.mp4'))
    if (!f) throw new Error('no MP4 downloaded: ' + (await S('s.message')))
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,color_transfer,color_primaries:format=duration', '-of', 'compact', join(OUT, f)]).toString().trim().replace(/\n/g, ' | ')
    return `${f}: ${probe}`
  })
  await step('camera: sample yourself onto the Clip', async () => {
    const before = await S('s.clips.length')
    await evaluate(`(async () => {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      const rec = new MediaRecorder(s), parts = []
      rec.ondataavailable = (e) => parts.push(e.data)
      const done = new Promise((ok) => (rec.onstop = ok))
      rec.start(); await new Promise((r) => setTimeout(r, 2000)); rec.stop(); await done
      s.getTracks().forEach((t) => t.stop())
      await window.__vs.importFiles([new File(parts, 'camera.webm', { type: 'video/webm' })])
    })()`)
    await until(`window.__vs.store.get().clips.length === ${before + 1}`, 60000)
    return await S('`${s.clips.at(-1).name}: ${s.clips.at(-1).duration.toFixed(1)} s, root ${s.clips.at(-1).rootFound ? s.clips.at(-1).root.toFixed(1) : "none"}`')
  })
  await step('pads: two pads, a choke group, Home grid', async () => {
    await evaluate("window.__vs.setKind('pads')")
    const ids = await S('s.clips.map((c) => c.id)')
    await evaluate(`window.__vs.setPad(36, { clipId: '${ids[0]}', choke: 1 }); window.__vs.setPad(37, { clipId: '${ids[1]}', choke: 1 }); window.__vs.setPad(38, { clipId: '${ids[0]}', playNote: 72 })`)
    await key('KeyZ', 'keyDown'); await key('KeyC', 'keyDown'); await sleep(300)
    const both = await S('s.voices')
    await key('KeyX', 'keyDown'); await sleep(250) // choke: X cuts Z
    const afterChoke = await S('s.voices')
    await shot('06-pads-home.png')
    for (const c of ['KeyZ', 'KeyX', 'KeyC']) await key(c, 'keyUp')
    if (both !== 2 || afterChoke !== 2) throw new Error(`voices ${both} then ${afterChoke} after the choke`)
    return `Z+C ${both} tiles; X choked Z: ${afterChoke}`
  })
  await step('pads: swap, layer, 16 Levels, note repeat', async () => {
    await evaluate("window.__vs.setKind('pads')")
    const pair = () => S('s.pads.chains.filter((c) => c.note === 36 || c.note === 37).map((c) => c.note + ":" + c.clipId).sort().join(" ")')
    const before = await pair()
    await evaluate('window.__vs.swapPads(36, 37)')
    const swapped = await pair()
    await evaluate('window.__vs.layerPad(38, 36)')
    const layered = await S('s.pads.chains.filter((c) => c.note === 36).length')
    await evaluate("window.__vs.setPads({ selected: 37 }); window.__vs.setPadPlay({ levels: true })")
    const tl = await evaluate('window.__vs.ctx.currentTime') // only the voices this press starts (a one-shot from the step before may still sound)
    await key('Digit4', 'keyDown'); await sleep(200) // the top-right pad of the block: the loudest level
    const vel = await evaluate(`window.__vs.performer.book.voices.filter((v) => v.note === 37 && v.off === Infinity && v.on >= ${tl}).map((v) => v.vel).join(",")`)
    await key('Digit4', 'keyUp')
    await evaluate("window.__vs.setPadPlay({ levels: false, repeat: true, rate: 0.25, swing: 0 }); window.__vs.setTransport({ bpm: 120 })")
    const t0 = await evaluate('window.__vs.ctx.currentTime')
    await key('KeyX', 'keyDown'); await sleep(1050); await key('KeyX', 'keyUp') // pad 37 at 1/16 and 120 BPM: a hit every 0.125 s
    const hits = await evaluate(`new Set(window.__vs.performer.book.voices.filter((v) => v.note === 37 && v.on >= ${t0}).map((v) => v.on.toFixed(3))).size`)
    await evaluate("window.__vs.setPadPlay({ repeat: false })")
    if (before === swapped || layered !== 2 || vel !== '127' || hits < 6) throw new Error(`swap ${before} → ${swapped}; layered ${layered}; level vel ${vel}; repeat hits ${hits}`)
    return `swapped (${swapped}); pad 36 layered ×${layered}; 16 Levels top-right = vel ${vel}; ${hits} repeat hits in about a second`
  })
  await step('layers: two layers, the selector morphs held notes', async () => {
    await evaluate("window.__vs.setKind('layers')")
    const ids = await S('s.clips.map((c) => c.id)')
    await evaluate(`window.__vs.addLayer(); window.__vs.addLayer()`)
    const layer = await S('s.layers.chains.map((c) => c.id)')
    await evaluate(`window.__vs.setLayer('${layer[0]}', { clipId: '${ids[0]}', selLo: 0, selHi: 63, selFade: 32 }); window.__vs.setLayer('${layer[1]}', { clipId: '${ids[1]}', selLo: 64, selHi: 127, selFade: 32 })`)
    await evaluate('window.__vs.setMacro(0, 0)')
    await key('KeyA', 'keyDown'); await sleep(300)
    const g0 = await evaluate('window.__vs.performer.book.live(window.__vs.ctx.currentTime).map((v) => v.gains.at(-1)[1].toFixed(2)).join("/")')
    await evaluate('window.__vs.setMacro(0, 127)'); await sleep(300)
    const g1 = await evaluate('window.__vs.performer.book.live(window.__vs.ctx.currentTime).map((v) => v.gains.at(-1)[1].toFixed(2)).join("/")')
    await shot('07-layers.png')
    await key('KeyA', 'keyUp')
    return `selector 0: layer gains ${g0}; selector 127: ${g1}`
  })
  await step('the song: a board cell recorded live, a second track, each track its own tile', async () => {
    await evaluate("window.__vs.setKind('clip'); window.__vs.setClip({ clipId: window.__vs.store.get().clips[0].id })")
    await evaluate('window.__vs.setTransport({ bpm: 120, bars: 1, countIn: false, metronome: false, quantize: 4 })')
    const t1 = await S('s.sel')
    await evaluate("window.__vs.store.set({ view: 'board' }); window.__vs.launchScene('A'); window.__vs.songRecord()")
    for (const k of ['KeyA', 'KeyD', 'KeyG']) { await key(k, 'keyDown'); await sleep(180); await key(k, 'keyUp'); await sleep(250) }
    await sleep(2300) // the 2 s pass closes into the cell
    await evaluate('window.__vs.songRecord()') // stop recording; the cell keeps looping
    const notes = await S(`s.tracks.find((t) => t.id === '${t1}').cells.A?.notes.length ?? 0`)
    // a second instrument track on another clip, its cell written directly
    await evaluate(`(() => { const a = window.__vs; const t = a.addTrack('instrument'); a.setClip({ clipId: a.store.get().clips[1].id }); a.setCell(t.id, 'A', { id: 'x', start: 0, len: 4, loop: 4, notes: [{ at: 0, len: 1, note: 60, vel: 100 }, { at: 2, len: 1, note: 64, vel: 100 }] }) })()`)
    const t0 = await evaluate('window.__vs.ctx.currentTime')
    await sleep(2400)
    const tracks = await evaluate(`new Set(window.__vs.book.voices.filter((v) => v.on > ${t0}).map((v) => v.track)).size`)
    const tiles = await evaluate(`[...window.__vs.stage.inner.keys()].length`)
    await shot('08-board.png')
    if (notes < 3 || tracks < 2) throw new Error(`cell notes ${notes}, tracks sounding ${tracks}, track regions ${tiles}`)
    return `cell A of track 1: ${notes} notes; ${tracks} tracks sounding in scene A, ${tiles} track regions on stage`
  })
  await step('the timeline: scene A placed twice, played from bar 1, then exported as one song', async () => {
    await evaluate("window.__vs.songStop(); window.__vs.placeScene('A'); window.__vs.placeScene('A'); window.__vs.store.set({ view: 'timeline' }); window.__vs.setPos(0)")
    const placed = await S('`${s.tracks.map((t) => t.clips.length).join(",")} clips, ${s.marks.length} marks, ${s.marks.map((m) => m.at).join("/")}`')
    const t0 = await evaluate('window.__vs.ctx.currentTime')
    await evaluate("window.__vs.songStart('timeline')")
    await sleep(1600)
    await shot('08b-timeline.png')
    const tracks = await evaluate(`new Set(window.__vs.book.voices.filter((v) => v.on > ${t0}).map((v) => v.track)).size`)
    await evaluate('window.__vs.songStop()')
    for (const f of readdirSync(OUT).filter((x) => x.endsWith('.mp4'))) rmSync(join(OUT, f))
    await evaluate("window.__vs.exportSong({ aspect: '16:9', layout: 'gallery', height: 720, fps: 30 })")
    await sleep(500)
    await until('!window.__vs.store.get().exporting', 180000)
    const f = readdirSync(OUT).find((x) => x.endsWith('.mp4'))
    if (!f) throw new Error('no MP4 downloaded: ' + (await S('s.message')))
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.2', '-i', join(OUT, f), '-frames:v', '1', join(OUT, '09-song-export-frame.png')])
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(OUT, f)]).toString().trim()
    if (!placed.startsWith('2,2 clips, 2 marks') || tracks < 2) throw new Error(`${placed}; ${tracks} tracks sounding`)
    return `${placed}; ${tracks} tracks sounding; ${f}: ${Number(probe).toFixed(2)} s`
  })
  await step('effects: delay and reverb sends; a released tile echoes and glows; the meter moves', async () => {
    await evaluate("window.__vs.setKind('clip'); window.__vs.setLayout('gallery'); window.__vs.setClip({ sends: { delay: 0.7, reverb: 0.6 } })")
    await key('KeyA', 'keyDown'); await sleep(350)
    const level = await evaluate('window.__vs.engine.fx.level(new Float32Array(2048))')
    await key('KeyA', 'keyUp')
    await sleep(500) // the sound's release is over; its echoes and its glow are not
    const cells = await S('s.voices')
    await shot('10-fx-echo.png')
    await evaluate('window.__vs.setClip({ sends: { delay: 0, reverb: 0 } })')
    if (cells < 1 || level < -50) throw new Error(`cells ${cells}, level ${level.toFixed(1)} dB`)
    return `mix ${level.toFixed(1)} dBFS while playing; ${cells} tile still on stage 0.5 s after release (echoes and glow)`
  })
  await step('sample editor: drag the start handle, double-click a manual slice', async () => {
    await evaluate("window.__vs.setKind('clip'); window.__vs.setClip({ clipId: window.__vs.store.get().clips[0].id, mode: 'classic', start: 0, end: 1, slices: [] })")
    await sleep(300) // the sample editor is the inspector's, under the knobs (ADR 0776)
    const measure = () => evaluate("(() => { const c = document.querySelector('.sampler-ed canvas'); c.scrollIntoView({ block: 'center' }); const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } })()")
    let r = await measure()
    await sleep(200)
    const mouse = (type, x, clickCount = 1) => page('Input.dispatchMouseEvent', { type, x, y: r.y + r.h / 2, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount })
    const under = await evaluate(`(() => { const e = document.elementFromPoint(${r.x + 2}, ${r.y + r.h / 2}); window.__ev = { down: 0, move: 0, up: 0 }; const c = document.querySelector('.sampler-ed canvas'); for (const k of ['down', 'move', 'up']) c.addEventListener('pointer' + k, () => window.__ev[k]++); return e ? e.tagName + '.' + e.className : 'nothing' })()`)
    await mouse('mouseMoved', r.x + 1); await mouse('mousePressed', r.x + 1)
    for (const f of [0.1, 0.2, 0.25]) await mouse('mouseMoved', r.x + r.w * f)
    await mouse('mouseReleased', r.x + r.w * 0.25)
    const start = await S('s.clip.start')
    await evaluate("window.__vs.setClip({ mode: 'slice', sliceBy: 'manual', start: 0 })")
    await sleep(300)
    r = await measure() // re-measure: the row above the editor changes with the mode
    await sleep(200)
    await mouse('mousePressed', r.x + r.w * 0.5, 1); await mouse('mouseReleased', r.x + r.w * 0.5, 1)
    await mouse('mousePressed', r.x + r.w * 0.5, 2); await mouse('mouseReleased', r.x + r.w * 0.5, 2)
    await sleep(200)
    const slices = await S('s.clip.slices.map((t) => t.toFixed(1)).join(",")')
    await shot('10b-sample-editor.png')
    await evaluate("window.__vs.setClip({ mode: 'classic', sliceBy: 'transient', slices: [], start: 0 })")
    if (Math.abs(start - 0.25) > 0.03 || !slices) throw new Error(`start ${start}, slices ${slices}, under the cursor ${under}, canvas ${JSON.stringify(r)}, events ${JSON.stringify(await evaluate('window.__ev'))}`)
    return `start dragged to ${start.toFixed(2)}; a manual slice at ${slices} s`
  })
  await step('capture: play three notes, Shift+Enter keeps them as a new take', async () => {
    await evaluate("window.__vs.setKind('clip'); window.__vs.setClip({ clipId: window.__vs.store.get().clips[0].id, mode: 'classic' })")
    const before = await S('s.takes.length')
    for (const k of ['KeyA', 'KeyD', 'KeyG']) { await key(k, 'keyDown'); await sleep(150); await key(k, 'keyUp'); await sleep(150) }
    await sleep(300)
    await page('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Enter', key: 'Enter', modifiers: 8, windowsVirtualKeyCode: 13 })
    await page('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Enter', key: 'Enter', modifiers: 8, windowsVirtualKeyCode: 13 })
    await sleep(300)
    const got = await S('`${s.takes.length} takes; current "${s.take?.name}" with ${s.take?.events.filter((e) => e.ev.type === "on").length} notes`')
    // the phrase runs back while notes are under 4 s apart, so the previous step's notes may join it
    if ((await S('s.takes.length')) !== before + 1 || (await S('s.take.events.filter((e) => e.ev.type === "on").length')) < 3) throw new Error(got)
    return got
  })
  await step('the window in light and dark: Clip, Pads, the timeline, the picture in 9:16 (screenshots at 1470×832)', async () => {
    await evaluate("window.__vs.setKind('clip'); window.__vs.setClip({ clipId: window.__vs.store.get().clips[0].id })")
    const seen = []
    // what spills out of the window, not what a scroller (the library, the board, the timeline, the inspector) keeps out of view
    const spill = () => evaluate("[...document.querySelectorAll('.app *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && !e.closest('.lib-grid, .board2, .tl, .insp-body, .takes-row, .screen') && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1) }).map((e) => e.className || e.tagName).slice(0, 5).join(' ')")
    const states = [
      ['clip', async () => { await click('.instruments button:nth-child(2)'); await evaluate("window.__vs.store.set({ view: 'board' })") }],
      ['pads', async () => { await click('.instruments button:nth-child(3)') }],
      ['timeline', async () => { await click('.instruments button:nth-child(2)'); await evaluate("window.__vs.store.set({ view: 'timeline' })") }],
      ['picture', async () => { await evaluate("window.__vs.set('aspect', '9:16')"); await click('.picsel') }],
    ]
    for (const mode of ['light', 'dark']) {
      await evaluate(`document.documentElement.dataset.theme = '${mode}'`) // the theme is a setting (ADR 0774), light by default
      for (const [name, set] of states) {
        await set()
        await sleep(400)
        const over = await spill()
        seen.push(`${name}${over ? ` (outside the window: ${over})` : ''}`)
        await shot(`12-${name}-${mode}.png`)
      }
      await click('.picsel') // back to the track
      await evaluate("window.__vs.set('aspect', '16:9'); window.__vs.store.set({ view: 'board' })")
    }
    const bg = await evaluate("getComputedStyle(document.body).backgroundColor")
    await evaluate("document.documentElement.dataset.theme = 'light'")
    if (seen.some((x) => x.includes('outside'))) throw new Error(seen.join(', '))
    return `${seen.slice(0, 4).join(', ')} captured in both; body in dark ${bg}`
  })
  await step('undo an edit; the project saves itself and comes back after a reload', async () => {
    await evaluate("window.__vs.setKind('clip'); window.__vs.setClip({ filter: { ...window.__vs.store.get().clip.filter, type: 'hp', cutoff: 800 } })")
    await sleep(700)
    await evaluate('window.__vs.undo()')
    const after = await S('s.clip.filter.type')
    await sleep(1800) // the autosave settles a second after the last edit
    const before = await S('JSON.stringify(s.clips.map((c) => c.id))')
    const saved = await evaluate("(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('video-sampler'); return JSON.parse(await (await (await d.getFileHandle('project.json')).getFile()).text()).clips.length })()")
    await evaluate('location.reload()')
    await sleep(1500)
    await until(`window.__vs && JSON.stringify(window.__vs.store.get().clips.map((c) => c.id)) === ${JSON.stringify(before)}`, 240000) // a loaded machine restores slowly
    const back = await S('`${s.clips.length} clips, kind ${s.kind}, ${s.tracks.length} tracks, ${s.tracks.reduce((n, t) => n + Object.keys(t.cells).length + t.clips.length, 0)} cells and timeline clips`')
    if (after !== 'off') throw new Error(`undo left ${after}`)
    return `undo → filter ${after}; saved ${saved} clips; after reload: ${back}`
  })
} finally {
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, console: logs }, null, 2))
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed; console errors/warnings: ${logs.length}`)
  for (const l of logs.slice(0, 12)) console.log('  ' + l.slice(0, 220))
  ws.close(); proc.kill('SIGTERM'); server.close()
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 800)
}
