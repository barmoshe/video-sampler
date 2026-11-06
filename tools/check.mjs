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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
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
const step = async (name, fn) => {
  try { const note = await fn(); results.push({ name, ok: true, note }); console.log(`PASS ${name}${note ? `  (${note})` : ''}`) }
  catch (e) { results.push({ name, ok: false, note: String(e.message ?? e) }); console.log(`FAIL ${name}  ${e.message ?? e}`) }
}
const S = (expr) => evaluate(`(() => { const s = window.__vs.store.get(); return ${expr} })()`)

try {
  await page('Page.navigate', { url: base })
  await until('!!window.__vs && !!window.__vs.stage && !!window.__vs.performer')
  await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 300, button: 'left', clickCount: 1 })
  await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: 300, button: 'left', clickCount: 1 })
  await shot('01-empty.png')

  await step('the demo clip: made in the browser, tuned to 220 Hz (A2)', async () => {
    const t0 = Date.now()
    await evaluate('window.__vs.loadDemo()')
    await until('window.__vs.store.get().clips.length === 1', 60000)
    const r = await S('`root ${s.clips[0].root.toFixed(2)} (A2 = 57), ${s.clips[0].frames} frames`')
    await evaluate('window.__vs.handlers.noteOn(60, 100, performance.now(), "keys"); window.__vs.handlers.noteOn(67, 100, performance.now(), "keys")')
    await sleep(400)
    await shot('00-demo.png')
    await evaluate('window.__vs.handlers.noteOff(60, performance.now()); window.__vs.handlers.noteOff(67, performance.now())')
    const root = await S('s.clips[0].root')
    await evaluate('window.__vs.removeClip(window.__vs.store.get().clips[0].id)')
    if (Math.abs(root - 57) > 0.2) throw new Error(r)
    return `${((Date.now() - t0) / 1000).toFixed(1)} s, ${r}`
  })
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
  await step('looper: record a layer, it loops as its own tile; a main video plays behind', async () => {
    await evaluate("window.__vs.setKind('clip'); window.__vs.setClip({ clipId: window.__vs.store.get().clips[0].id })")
    await evaluate('window.__vs.setTransport({ bpm: 120, bars: 1, countIn: false, metronome: false, quantize: 4 })')
    await evaluate('window.__vs.loopRecord()')
    for (const k of ['KeyA', 'KeyD', 'KeyG']) { await key(k, 'keyDown'); await sleep(180); await key(k, 'keyUp'); await sleep(250) }
    await sleep(2300) // the 2 s pass closes into layer 1
    await evaluate('window.__vs.loopRecord()') // stop recording; the layer keeps looping
    const layers = await S('s.loopLayers.length'), notes = await S('s.loopLayers[0]?.notes.length ?? 0')
    await evaluate("window.__vs.setMain({ clipId: window.__vs.store.get().clips[1].id, gain: 0.3 })")
    await sleep(900)
    const cells = await evaluate("[...new Set(window.__vs.performer.book.sounding(window.__vs.ctx.currentTime).map((v) => v.cell))].join(' ')")
    await shot('08-looper-main.png')
    await evaluate('window.__vs.toggleRecord()'); await sleep(2200); await evaluate('window.__vs.toggleRecord()')
    const take = await S('`${s.take.events.length} events, main ${s.take.events.some((e) => e.ev.type === "main")}, hold ${s.take.hold}`')
    await evaluate('window.__vs.loopStop(); window.__vs.setMain({ clipId: null })')
    if (layers !== 1 || notes !== 3 || !/L:1/.test(cells) || !/main/.test(cells)) throw new Error(`layers ${layers}, notes ${notes}, cells ${cells}`)
    return `1 layer of ${notes} notes; sounding cells: ${cells}; take: ${take}`
  })
  await step('export the loop take with its main video (16:9, gallery)', async () => {
    for (const f of readdirSync(OUT).filter((x) => x.endsWith('.mp4'))) rmSync(join(OUT, f))
    await evaluate("window.__vs.export({ aspect: '16:9', layout: 'gallery', height: 720, fps: 30 })")
    await sleep(500)
    await until('!window.__vs.store.get().exporting', 180000)
    const f = readdirSync(OUT).find((x) => x.endsWith('.mp4'))
    if (!f) throw new Error('no MP4 downloaded: ' + (await S('s.message')))
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.2', '-i', join(OUT, f), '-frames:v', '1', join(OUT, '09-loop-export-frame.png')])
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(OUT, f)]).toString().trim()
    return `${f}: ${Number(probe).toFixed(2)} s`
  })
} finally {
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, console: logs }, null, 2))
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed; console errors/warnings: ${logs.length}`)
  for (const l of logs.slice(0, 12)) console.log('  ' + l.slice(0, 220))
  ws.close(); proc.kill('SIGTERM'); server.close()
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 800)
}
