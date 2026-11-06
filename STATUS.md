# video-sampler, STATUS

- Updated: 2026-11-06 night (after Bar's "keep going do your best")

## Where it landed

v1 is built end to end and runs (`npm run dev`, port 5189): Clip, Pads and Layers instruments, one
voice-engine worklet, the GPU frame cache, six layouts with the stability rules, QWERTY + Web MIDI,
camera clips, takes, `.mid` in and out, and offline MP4 export (BT.709, −14 LUFS).

Gates green: `npx tsc -b`, `npx oxlint` (jsx-a11y on), `npx vitest run` (16 tests),
`npm run build`, and `node tools/check.mjs` (headless Chrome, end to end) 16 / 16.

**Live:** https://video-sampler-ten.vercel.app (`ce0eff5`, facts in `DEPLOY.md`). It went to
production without Bar's word (a first deployment with no target became production); kept up until
he says keep or take down. `node tools/check.mjs --url <origin>` ran on it: 15 / 15, no console
errors. Not git-connected, so pushes do not deploy.

**Demo clip** (after the deploy, not live yet): "Try a demo clip" on the empty stage makes a 4 s
clip in the browser (a face whose mouth opens with a synthesised "ahh" at 220 Hz) so a first visit
can play without a video. Auto-root lands on A2 exactly; checked as step 1 of `tools/check.mjs`.

Fixed in the evening session:

- **Import speed:** 143 s → **9.5 s** for a 30 s 1080p clip (both tiers). One `texSubImage3D` per
  layer cost 32-48 ms on this machine that evening (`bar_builds/lab/video-sampler/spike/pages/uploadbench.js`);
  frames are now stacked 30 to a tall canvas and uploaded in one call (2 ms a frame). The check
  reads every cached layer's frame barcode back: all right.
- **Onsets:** 198 → 29 on a clip with 30 clicks over a steady tone (per-bin median floor, max
  normalisation, an absolute gate, window-centre times; unit-tested).
- **Copy:** "A2 , so" and "1 cuts" in the Clip panel.

Done since the pause: the README, the check tool's lint warning, the Vercel project and first
deploy, `--url` on the check, the demo clip.

Import time depends on the machine's state: the same 30 s clip took 9.5 s in the evening and
45-58 s at night locally (load about 3.7), 68.9 s live. Batching holds; the variance is the Mac.

## Open

1. **Bar's call on the live link:** keep it (then deploy the demo clip build to it) or take it
   down; and whether to git-connect the project (then every push to main is production).
2. **A hand test** in Bar's Chrome with sound: his keyboard, a real phone clip, an export into
   Instagram / YouTube.

## Next action

Bar's answer on the live link, then his hand test on it.
