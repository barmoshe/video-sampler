# Pack art (3D clips) — handoff, 2026-11-07 00:48

Session: the Blender pack-art side session (no web, no downloads: bpy safety rule, knowledge/33 §33.9).
Stopped on Bar's word ("stop for now"). Background render stopped; nothing running.

## State right now

- **scene.py does not run as it stands:** `build_cymbal` now calls `cymbal_mesh(name, R, bronze, parent=piv)`,
  which is not written yet (I was mid-way through adding the shared helpers). Write it first: the cymbal
  profile that used to be inline (top points (0.007,0.040) ... (R,0.0), thickness 0.0026 - 0.0013 r/R,
  closed lathe, z shifted by -0.04, segs 128, sharp 60), scaled for R, so the hi-hat can reuse it.
- Added and untested: `lathe(..., arc=(a0, a1))` (a capped partial lathe, for the tambourine's slots),
  each drum head gets its own material copy (glow is in object space), shared materials `hand` and `rawhide`.
- **Light and exposure solved (round 4):** the kit's `product` rig sat 2.5x the model's size away and
  burned the floor; it is replaced by `RIG` in `studio()`: big soft area lights at about 6x the size
  (key upper left, fill, thin rim, overhead) plus a spot washing the backdrop, near-neutral 6300-6600 K.
  At exposure -1.6 the top of the frame measures `#ECE8DD` (target `#ECE8DE`); the default is now -1.35 so
  the foreground floor is not grey. New flags: `--exposure`, `--wash`. Snare at -1.6 looks like a real
  product shot (`scratchpad/render/r4/snare-rig-1.6/f0000.png`).
- Round 3 verdict: marimba, snare and cymbal all read well; display-stand base was reflecting white,
  now matte graphite (roughness 0.55, no coat).

## Open problem: full-clip speed

Stills render at about 2 s a frame in EEVEE, but the full snare clip (`render(animation=True)`) took
21-36 s a frame (14 of 27 frames done when stopped). Suspects: animation mode re-syncs or recompiles the
materials with keyed node values every frame, or the GPU was busy. Try first: render the clip as a loop of
`frame_set(f)` + `bb.render(...)` (the stills path, which measured 2 s), and time it.

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
