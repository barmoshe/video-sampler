# video-sampler, STATUS

- Updated: 2026-11-06 evening (paused on Bar's "Please stop all ... We will continue soon")

## Where it landed

v1 is built end to end and runs (`npm run dev`, port 5189): Clip, Pads and Layers instruments, one
voice-engine worklet, the GPU frame cache, six layouts with the stability rules, QWERTY + Web MIDI,
camera clips, takes, `.mid` in and out, and offline MP4 export (BT.709, −14 LUFS).

Gates green: `npx tsc -b`, `npx oxlint` (jsx-a11y on), `npx vitest run` (16 tests),
`npm run build`, and `node tools/check.mjs` (headless Chrome, end to end) 15 / 15.

Fixed in the evening session:

- **Import speed:** 143 s → **9.5 s** for a 30 s 1080p clip (both tiers). One `texSubImage3D` per
  layer cost 32-48 ms on this machine that evening (`bar_builds/lab/video-sampler/spike/pages/uploadbench.js`);
  frames are now stacked 30 to a tall canvas and uploaded in one call (2 ms a frame). The check
  reads every cached layer's frame barcode back: all right.
- **Onsets:** 198 → 29 on a clip with 30 clicks over a steady tone (per-bin median floor, max
  normalisation, an absolute gate, window-centre times; unit-tested).
- **Copy:** "A2 , so" and "1 cuts" in the Clip panel.

## Open

1. **README** (what it is, run, the gates, the check).
2. **Vercel project**, git-connected as riff.link, then deploy (a public link).
3. **A hand test** in Bar's Chrome with sound: his keyboard, a real phone clip, an export into
   Instagram / YouTube.
4. One lint warning in `tools/check.mjs:45` (a ternary used as a statement).

## Next action

README, then the Vercel project and deploy, then Bar's hand test.
