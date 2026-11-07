# video-sampler, STATUS

- Updated: 2026-11-07 evening (session close-out on Bar's word)

## Now (read this first)

The app is **VIDAW**, a video DAW (ADRs 0772, 0773, 0774 in the workshop). On `main`: the song model
(tracks of four kinds, board and timeline, each track a tile, song export) and the first brand pass
(Ableton's discipline, the split-screen mark, light by default), **awaiting Bar's review**. Gates: tsc,
oxlint (zero warnings), 65 unit tests, build, and `node tools/check.mjs` 29 / 29 in light and dark;
CI green on `07d87d1`. Production still serves the v1 demo build `9c50d8f`; nothing newer is deployed.
The full picture, open items and questions: `bar_builds/lab/video-sampler/HANDOFF.md`.

## History (v1, kept for the record)

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

## v3 (in progress, on Bar's "I want a full production ready app")

Design and decisions: `bar_builds/lab/video-sampler/production.md`, ADRs 0770 and 0771; the running
handoff is `bar_builds/lab/video-sampler/HANDOFF.md`. Landed on `main` (not deployed): tune to the
nearest note with a home key the keyboard follows; scale lock and chord mode; framed tiles with a pop
on the hit; a Home grid that fits; a per-voice filter, filter envelope and LFO with picture twins (blur,
edges, glow, contrast); clip and pad thumbnails; the looper (transport, layers as tiles, undo / redo /
mute) and a main video behind the tiles; the pack's CC0 sources (`tools/library/`). The pack's 3D
artwork renders in a separate session into `public/library/`.

## Open

1. Whether to git-connect the Vercel project (then every push to main is production).
2. **A hand test** in Bar's Chrome with sound: his keyboard, a real phone clip, an export into
   Instagram / YouTube.

## Next action

Continue v3 in the order of the handoff's "Next, in order"; then a preview deploy for Bar's hand test.
