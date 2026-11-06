// Debug: which stage of the import is slow? Polls the app's import progress every 2 s.
import { readFileSync } from 'node:fs'
const src = readFileSync('tools/check.mjs', 'utf8')
const head = src.slice(0, src.indexOf('try {\n  await page'))
const body = `
try {
  await page('Page.navigate', { url: base })
  await until('!!window.__vs && !!window.__vs.stage && !!window.__vs.performer')
  const t0 = Date.now()
  await setFiles([join(MEDIA, process.env.CLIP ?? 'clip30.mp4')])
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    const st = await evaluate('JSON.stringify(window.__vs.store.get().importing) + " clips=" + window.__vs.store.get().clips.length')
    console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', st)
    if (st.endsWith('clips=1')) break
  }
} finally { console.log(logs.slice(0, 8)); ws.close(); proc.kill('SIGTERM'); server.close() }
`
await import('data:text/javascript;base64,' + Buffer.from(head + body).toString('base64'))
