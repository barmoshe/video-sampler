# Pack art (3D clips) — handoff, 2026-11-06 23:22

Session: the Blender pack-art side session (no web, no downloads: bpy safety rule, knowledge/33 §33.9).
Paused a third time on Bar's word ("create handoff and wait"). Nothing committed; only test stills rendered.

## Where it stands

- `../video-sampler/tools/library/render/scene.py` (untracked) runs end to end for **marimba, snare and
  cymbal** (stills, strip, views sheet, `info.json`). Also written but not yet run: vibraphone, xylophone,
  balafon (shared `bar_instrument`). 20 builders still to write.
- **Engine decided: EEVEE** (now the default; `--engine CYCLES` still works). Measured: Cycles CPU 20-33 s
  a frame at 24 spp; EEVEE 64 samples about 2 s a frame after a 13 s first-frame shader compile, with soft
  contact shadows that look close to Cycles. The whole pack (1,294 frames) is about 45 min.
- Defaults now: 64 samples, motion blur **off** (`--blur` turns it on; EEVEE ghosted the mallet on the
  rebound frame), exposure -0.5, a neutral backdrop wash light, world 0.22.
- Strikers: graphite shafts, orange heads/tips (pale hickory vanished on the sweep). Framing uses the
  instrument + the striker's head only, so shafts may leave the frame. Rebound angle 12°.
- Glow: radius about L × 0.13 (bars), 0.06 (snare head), 0.07 (cymbal); gain about 2.2-2.5.
- Bar instruments are lower now (short thick legs, short resonators). Snare shell is black nickel.
- Render scratch: `/private/tmp/claude-501/-Users-barmoshe-bar-builds/fd550047-3bc7-412b-b9af-b3a34b6a37d7/scratchpad/render/`
  (`r2/` and `r3/` per sound: `f0000.png`, `strip.png`, `views.png`). Not `video-sampler/tools/out/`,
  which something else clears.

## Round 3: rendered, not yet looked at

Rendered just before the pause; the pictures have not been Read. One number came back: the floor still
samples about `#FBF5E9` (top of frame `#DDD7CC`-`#F7F2E7`), so -0.5 exposure barely moved it; the target is
`#ECE8DE`. Next look: lower the light powers themselves (the `studio()` multipliers, the wash at 0.9) or
exposure about -1.0, and check the sweep's warmth (lights are 5600 K).

Round 2 notes, still true until round 3 is checked: cymbal reads well (wobble and edge glow visible);
snare looked like a pale ghost (fixed by the dark shell?); the marimba bar was small in frame (fixed by
framing on the mallet head only?).

## Next steps

1. Read `r3/*/strip.png` and `views.png`; fix exposure; `eyes measure` with a spec of `#ECE8DE`,
   `#2B2B30`, `#F2621B`; keep the best of the rounds (about one more round, then move on).
2. Render one full clip (snare, 27 frames) and mux it to check timing and the loop.
3. Write the other 20 builders: strikers come from behind and above (never between model and camera);
   mounted items on the shared graphite display stand; graphite mannequin hands (capsules) for clap,
   kalimba thumb, cajon, conga, bongo, frame drum, tambourine; ocarina = looping orange breath puffs;
   harp C strings muted orange, F strings graphite.
4. Render all 26 at 960×540 in background jobs under ~25 min each (jobs stop at 30 min).
5. `pack.py` beside scene.py: mux per ART.md, poster = loudest frame as JPG, `public/library/manifest.json`
   + `CREDITS.md` from `assets-src/audio/credits.json`, `sheet.png` of the 26 posters, under ~40 MB.
6. Commit only `tools/library/render/` and `public/library/` on main (another session has uncommitted
   `src/` edits there), push, add the "Pack art" line to `lab/video-sampler/STATUS.md`.
7. Still off, to report: snare wires can't be seen from a 23° camera.

## Added by the main session (2026-11-07)

- Copied here from the side session's notes folder so it survives; the round-3 strips are `r3-*-strip.png`
  beside it (not yet reviewed). `tools/check.mjs` empties `tools/out/` when it starts.
