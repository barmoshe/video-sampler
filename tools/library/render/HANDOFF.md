# Pack art (3D clips): handoff, 2026-11-07 06:10 (done: 26 clips in public/library, `1ef4e48`)

Session: the Blender pack-art side session (no web, no downloads: bpy safety rule, knowledge/33 §33.9).

## State

- `scene.py` builds all 26 instruments (`build_<id>`), one shared studio set, EEVEE by default. Every one
  smoke-rendered (frames 0 and 4) and was judged on contact sheets over two rounds, then rendered whole and
  packed: 26 MP4s + posters, `manifest.json`, `CREDITS.md` in `public/library/` (3.6 MB), `sheet.png` here.
  The PNG frames were scratch and are gone; `render.sh` + `pack.py` rebuild them (about 2 h on this Mac).
- `render.sh OUT id...` renders whole clips (frames only); `pack.py OUT` muxes them into `public/library/`
  (MP4 per ART.md, poster = loudest frame, `manifest.json` as `{items: [...]}` in the shape `src/engine/library.ts`
  reads, `CREDITS.md`) and writes `sheet.png` here. It keeps manifest entries that are not this pack's.
- Light: big soft area lights about 6x the model's size away (key upper left, fill, thin rim, overhead), a spot
  washing the backdrop, a sphere probe so metals reflect the sweep; exposure -1.35. The top of the frame measures
  `#ECE8DD` at -1.6 against the `#ECE8DE` target.
- Speed: render frame by frame (`frame_set` + still), about 2.3 s a frame; `render(animation=True)` took 20-36 s.

## Look decisions made here (for Bar to overrule)

- Strikers come from behind and above (the player's side), graphite shafts with orange heads or tips; the
  framing uses the instrument plus the striker's head, so shafts leave the frame at the top right.
- Hands are a graphite mannequin hand (capsules), for clap, cajon, conga, bongo, frame drum, tambourine;
  the kalimba gets a thumb only.
- Mounted instruments sit on one shared graphite display stand (cymbal, hi-hat, tom, cowbell, tambourine,
  frame drum, tubular glockenspiel).
- Ocarina: looping orange breath puffs out of the window. Harp: C strings muted orange, F strings graphite.
- Motion blur is off (EEVEE ghosted the rebound frame).
- `pack.py` credits the art to Bar Builds and claims no licence for it (the recordings are CC0-1.0).

## Still off

- Snare wires can't be seen from a 23 degree camera; the snare only rings.
- The piano reads as an action model (key, hammer, string); small parts in a wide frame.
- Wide instruments (snare, kick, strumstick, piano) fill the square crop, not a 9:16 one.
- Hands read as mannequin parts, not hands with skin.
