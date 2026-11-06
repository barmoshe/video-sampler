# Pack art (3D clips) — handoff, 2026-11-06 22:23

Session: the Blender pack-art side session (no web, no downloads: bpy safety rule, knowledge/33 §33.9).
Paused twice on Bar's word ("create handoff and wait"). Nothing committed; only test stills rendered.

## Where it stands

- `../video-sampler/tools/library/render/scene.py` (untracked) runs end to end for **marimba**:
  stills, strip, views sheet, `info.json`. Built so far: marimba, vibraphone, xylophone, balafon
  (shared `bar_instrument`), snare, cymbal. 20 builders still to write (plan below).
- Fixes from the first handoff are applied: grain is `along=`/`across=`, the cymbal felt/tilter is placed,
  the glow line is tidied. New flags: `--bounces N`, `--engine CYCLES|EEVEE` (EEVEE branch sets ray tracing,
  shadows and fast GI when the attributes exist; lights get `use_shadow_jitter`). **The EEVEE branch has
  never run** (the test was stopped).
- **Render scratch lives in the session scratchpad**, not `video-sampler/tools/out/` (that folder is the
  check tool's and something else writes there): `/private/tmp/claude-501/-Users-barmoshe-bar-builds/fd550047-3bc7-412b-b9af-b3a34b6a37d7/scratchpad/render/marimba/`
  (`f0000.png`, `strip.png`, `views.png`).

## Round 1 verdict (marimba, Cycles 24 spp)

1. **Too slow:** about 1.4 s per sample pass at 960×540, 20-33 s a frame even without motion blur
   (load average ~18 with other apps). 1,294 frames would take 8-10 hours. Next: time EEVEE on the GPU
   (`--engine EEVEE --samples 64 --frames 0,3`); if it is around 1-3 s a frame and looks right, use it for
   the pack. Otherwise try Cycles at 12-16 spp, fewer bounces, light tree off, and render in parallel
   background jobs under 25 min each.
2. **Composition:** the bar sits on a tall four-legged table; the frame is mostly legs and air, the bar is
   tiny. Make a low frame (rails on a graphite base on the floor), resonator short or dropped, so the bar
   is the hero.
3. **Glow too strong:** the whole bar turns orange. Smaller radius (about L × 0.12) and lower gain (~2).
4. **Rebound too big:** the mallet flies about 15 cm up. Angle 30° → about 12°.
5. **Backdrop:** the wall at the top of the frame goes grey-beige; the floor reads cream. Add a soft light
   on the backdrop or lift the world, then check the sweep against `#ECE8DE` with `eyes`.

## Next steps

1. EEVEE timing and look (above); pick the engine.
2. Apply verdicts 2-5, rerun marimba; then snare and cymbal. About 3 rounds, keep the best.
3. Write the other 20 builders: strikers come from behind and above (never between model and camera);
   mounted items on the shared graphite display stand; graphite mannequin hands (capsules) for clap,
   kalimba thumb, cajon, conga, bongo, frame drum, tambourine; ocarina = looping orange breath puffs;
   harp C strings muted orange, F strings graphite.
4. Render all 26 at 960×540 in background jobs under ~25 min each.
5. `pack.py` beside scene.py: mux per ART.md, poster = loudest frame as JPG, `public/library/manifest.json`
   + `CREDITS.md` from `assets-src/audio/credits.json`, `sheet.png` of the 26 posters, under ~40 MB.
6. Commit only `tools/library/render/` and `public/library/` on main (another session has uncommitted
   `src/` edits there), push, add the "Pack art" line to `lab/video-sampler/STATUS.md`.
7. Still off, to report: snare wires can't be seen from a 23° camera.

## Added by the main session when pushing (2026-11-06 22:30)

- Copied here from the side session's notes folder so it survives the session; the round-1 marimba
  still is `r1-marimba-f0000.png` (the other test frames stayed in that session's scratch folder).
- Why `tools/out/` "vanished": `tools/check.mjs` empties `tools/out/` when it starts. Keep renders in
  `tools/library/render/out/` (git-ignore it) or a scratch folder.
- Bar paused both sessions ("stop all ... we will resume later today ... push all to main"); resume this
  work from the render session, starting at "Next steps" 1.
