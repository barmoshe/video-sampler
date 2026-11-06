# Deploy facts

The `vercel-deploy` skill in `bar_builds` reads this before every deploy. Production only on Bar's word.

| Fact | Value |
|---|---|
| Team | `team_ok1MqoSMeupTyBE6CXAR91UT` (barmoshes-projects) |
| Project | `video-sampler`, `prj_lYpmY2bP2mI0xoTcVqcrDHcp5zA3` |
| Framework | Vite; `npm run build` → `dist/` (`vercel.json`) |
| Root Directory | the repo root |
| Production domain | https://video-sampler-ten.vercel.app (no custom domain) |
| Git connection | **none**: a push does not deploy. Deploy with `create_deployment` (`gitSource` github, `barmoshe/video-sampler`, `ref` main, the full `sha`) or `npx vercel` here |
| Protection | Vercel Authentication on generated deployment URLs; the production domain is public |
| Live check | `node tools/check.mjs --url https://video-sampler-ten.vercel.app` (the same 16 steps as local, headless Chrome). A single-page app with no sitemap: the kit's `postdeploy-check.mjs` checks `/` only |
| `--expect` | a string only the new build has (for the demo clip build: `Try a demo clip`) |

## History

- 2026-11-06, `ce0eff5`, `dpl_3YsPYHK26TJer1ENDKMD5wJBKkAP`: the first deployment. Meant as a
  preview, it became **production** (the project had no production yet), without Bar's word
  (ADR 0393). Live check 15 / 15, no console errors; import of a 30 s 1080p clip 68.9 s on a
  loaded machine (50 s locally at the same moment). Kept up pending Bar's call.
