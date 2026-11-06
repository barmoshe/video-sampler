# video-sampler, STATUS

- Updated: 2026-11-06 (paused on Bar's "Stop off for now")

## Where it landed

v1 is built end to end and runs (`npm run dev`, port 5189): Clip, Pads and Layers instruments, one
voice-engine worklet, the GPU frame cache, six layouts with the stability rules, QWERTY + Web MIDI,
camera clips, takes, `.mid` in and out, and offline MP4 export (BT.709, −14 LUFS). `npm run build`,
`npx tsc -b`, `npx oxlint` (jsx-a11y on) and `npx vitest run` are green. `node tools/check.mjs`
(headless Chrome, end to end) passed 15 / 15.

## Open

1. **Import speed.** A 30 s 1080p clip took about 140 s to load in the last runs. The time is in
   `texSubImage3D` (about 75 ms per upload). The spike's own ingest test, unchanged, also slowed
   from 7.7 s to 75 s on the same machine the same evening, so the machine's state (GPU or
   thermal) is the first suspect. Re-measure on a cool machine; if uploads stay slow, try WebGPU
   `copyExternalImageToTexture` or uploading from a worker.
2. **Onsets** are too eager (198 on a clip with 30 clicks over a steady tone): tune the flux
   threshold.
3. **Copy:** "A2 , so" stray space and "1 cuts" in the Clip panel.
4. README, CLAUDE.md, Vercel project (git-connected), and the workshop registration.

## Next action

Re-measure import on a cool machine, then the open items above, then deploy.
