# Pack artwork spec (3D renders, ADR 0770 in bar_builds)

Every sound in `pack.json` gets a short 3D-rendered clip of its object playing it. One style for the
whole pack, so a collage of any mix reads as one set. Made headless with the workshop's Blender kit
(`bar_builds/.claude/scripts/blender/`, `bb.py`), never flat code-drawn art.

## Look: the Instrument direction

- **Palette:** off-white body `#ECE8DE`, graphite `#2B2B30`, one accent orange `#F2621B` (the strike, the
  glow, a mallet head). Real material colour for the instrument itself (rosewood, brass, steel, drum
  skin), slightly desaturated so the set agrees.
- **Set:** a seamless studio sweep in warm off-white (light pack) with a soft contact shadow; the object
  sits on it. No text, no logos.
- **Light:** soft key from the upper left, a large fill, a thin rim from behind so edges read on the
  off-white sweep. View transform `Khronos PBR Neutral` (product colour), per knowledge §34.1.
- **Camera:** a 3/4 product shot, 50-85 mm, the object filling about 60 % of the frame height and
  centred, so a square or 9:16 crop of the 16:9 frame keeps it (the app crops tiles to their cell).
  The camera holds still; only the instrument moves.
- **Modelling:** procedural bpy primitives, bevelled edges, real proportions (metres). No downloads
  unless Bar says yes (Poly Haven / Kenney / Quaternius are CC0 if he does).

## Motion: the sound drives it

- **Frame 0 is the hit.** The sample's sound starts at t = 0 (trimmed to its first sound), so the
  mallet, stick, hand or pluck makes contact on frame 0. Anticipation is not possible before frame 0;
  start the striker at the contact point and let it rebound.
- **The decay follows the audio.** Compute the RMS envelope of the prepared WAV per video frame
  (30 fps) and drive the object's vibration amplitude, a subtle accent glow (emission on the struck
  part, orange) and any visible motion (a cymbal wobble, a string's blur, a drum skin's ripple) from it,
  so the picture rings exactly as long as the sound.
- **Length = the sound's length** (`assets-src/audio/credits.json` → duration), 30 fps. The last frame
  should rest close to the first frame's pose, so a looping note doesn't jump.

## Render and delivery

- 960 × 540, 30 fps, EEVEE or Cycles (whichever the kit says suits this Mac), PNG frames, then:
  `ffmpeg -framerate 30 -i frames/%04d.png -i assets-src/audio/<id>.wav -c:v libx264 -pix_fmt yuv420p
  -crf 18 -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -b:a 192k -shortest
  -movflags +faststart public/library/<id>.mp4`.
- A poster `public/library/<id>.jpg` (the frame at the loudest point).
- `public/library/manifest.json`: one entry per clip: id, name, kind (pitched / drum), file, poster,
  duration, credits (source path, URL, licence CC0-1.0, author "VCSL contributors"), and the art credit.
- `public/library/CREDITS.md`: the human-readable credits page.
- Judge with the kit's loop: views sheet, hero still, `eyes` against this spec, keep the best; stop
  after about three rounds per look and show Bar the best set with what is still off.
