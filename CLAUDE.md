# CLAUDE.md, video-sampler

Full-autonomy sibling of the bar_builds workshop (registered there in `.repos.json`; the workshop
pointer folder is `bar_builds/lab/video-sampler/`, which holds the brief, research, design,
`math.md`, the spike and ADR 0767). Build, commit and push freely here.

## What it is

A playable video sampler in the browser. Three instruments on one engine: Clip (Simpler-like),
Pads (Drum Rack-like) and Layers (Instrument Rack-like). Every note plays a clip with picture and
sound repitched together; every sounding note joins a live collage; takes export to MP4. Making
videos leads (ADR 0767); the Mac keyboard is the first controller.

## Stack

Vite + React 19 + TypeScript strict. `src/engine/` is plain TS with no React: one AudioWorklet
voice engine (`worklet/voice-engine.ts`), the voice book (`voicebook.ts`, the picture is a pure
function of it and the time), instruments, performer, WebGL2 frame cache and collage (`gl.ts`,
`stage.ts`), layouts (`layout.ts`), Mediabunny ingest (`media.ts`) and export (`export.ts`). React
reads one store (`store.ts`, `app.ts`). Plain CSS in `src/styles/app.css`.

## Rules

- **The audio engine is the clock.** The picture is drawn for the audio time audible when the frame
  reaches the eye, plus the calibrated picture offset (math §2). Never give the picture its own
  timer.
- **A tile never appears after its sound** (BT.1359; the spike's slo-mo films).
- **Never pitch with `AudioBufferSourceNode`**: Chrome and Safari interpolate linearly with no
  anti-aliasing. Voices go through the worklet's mip-mapped samples.
- **Formulas live in `bar_builds/lab/video-sampler/math.md`**; cite the section in code comments.
- **No AGPL / GPL / LGPL code.** Mediabunny (MPL-2.0) is used unmodified.
- **No Bar Builds BB fonts here**: their licence covers bar-builds.com and Bar Builds' own materials,
  not a public repo. The app uses Archivo and JetBrains Mono from Google Fonts.
- **Copy:** no em dashes; plain, short. Not "Simpler" or "Drum Rack" as public names.
- **Gates before every push:** `npx tsc -b`, `npx oxlint` (jsx-a11y on), `npx vitest run`,
  `npm run build`, and `node tools/check.mjs` (headless Chrome end to end) when the engine or UI
  changed. Test at 1470×832.
- **Deploy:** facts in `DEPLOY.md`. The Vercel project is not git-connected, so a push does not
  deploy; production only on Bar's word (ADR 0393), then `node tools/check.mjs --url <origin>`.

## State

`STATUS.md` here (open items), and the workshop's `lab/video-sampler/HANDOFF.md`.
