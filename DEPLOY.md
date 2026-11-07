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
| `--expect` | a string only the new build has (VIDAW build: `<title>VIDAW</title>`) |

## History

- 2026-11-06, `ce0eff5`, `dpl_3YsPYHK26TJer1ENDKMD5wJBKkAP`: the first deployment. Meant as a
  preview, it became **production** (the project had no production yet), without Bar's word
  (ADR 0393). Live check 15 / 15, no console errors; import of a 30 s 1080p clip 68.9 s on a
  loaded machine (50 s locally at the same moment). Kept up pending Bar's call.
- 2026-11-07, `96e07c5`, `dpl_C1empctLXVja3jjPbBnYZde4eyRs`: a **preview** (target none) of VIDAW (the
  video DAW and the first brand pass) for Bar's review, on his "Yes, preview". READY in about 10 s;
  `/` serves the VIDAW build (title, Instrument Sans, favicon), `/library/manifest.json` the 26-item pack.
  Behind Vercel Authentication; a share link (expires 2026-11-08 18:14) was handed to Bar. Production is
  unchanged (`9c50d8f`).
- 2026-11-07, `3f1aa2c`, `dpl_GeQEdTBpi1oo1XB2ivh3AWexRLfX`: a **preview** of the design system (ADR 0775:
  glass panels and capsules over a solid window with the mark's tiles as a wallpaper), on Bar's "Yes, fix
  the glass". READY in about 10 s; `/` serves the same `index-CfgOm7FW.css` as the build the check passed.
  Share link until 2026-11-08 19:12. Production is unchanged (`9c50d8f`).
- 2026-11-07, `636dc9a`: the window of ADR 0776 (the picture is the desk; no modes, no keys on screen),
  on Bar's "Push and deploy what we have by now" and "push to main and update all relevant docs deploy".
  Preview `dpl_jc8gMaffQ5AsBbpuhBhevLc295zZ` read first (same `index-YcSZVPtd.js` and
  `index-CaGn_2l7.css` as the local build), then **production** `dpl_8fxMy6F7WjBgDbns4jWNp8FycBek`, READY
  in about 12 s; the domain moved by itself (`list_deployment_aliases` lists video-sampler-ten.vercel.app).
  `postdeploy-check.mjs https://video-sampler-ten.vercel.app --expect index-YcSZVPtd.js`: OK. The full
  `tools/check.mjs --url` live run was not done (a local full run was still going); the last two local full
  runs were 28 / 29 and 27 / 29 (the chord step in both, the reload step's OPFS read once; open in `STATUS.md`).
