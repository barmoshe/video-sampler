# video-sampler

Play a video like an instrument. Every key plays the clip at its own pitch, picture and sound
together: a higher note sings higher and moves faster. Every note you hold joins the picture, so a
chord is a collage. Record a take and export it as an MP4 for Reels, TikTok or YouTube.

Nothing is uploaded. Your clips stay in your browser.

## Three instruments

- **Clip** plays one video across the keyboard. It tunes itself: the clip's own pitch is detected,
  so C3 plays a real C. Classic (hold to sustain, loop with a crossfade), One-Shot, and Slice
  (by hit, by scene cut in the picture, or equal parts, one slice per key from C1).
- **Pads** gives each key its own clip: 128 pads in banks of 16, choke groups, volume, pan, and
  loudness levelled when a clip loads.
- **Layers** stacks clips: key and velocity zones with fades, and a selector that morphs one video
  into the next while you hold the notes (macro 1 or the mod wheel).

Six layouts arrange the sounding notes: Gallery, Keys, Stack, Mosaic, Spotlight and, for pads, a
Home grid. Tiles slide on springs and never jump; a fast trill does not shuffle the grid.

## The screen

One instrument: the stage on top, a deck below. The deck has four mode keys (Option+1 to 4):

- **Play**: the keys or the pads with the clips' pictures, scale and chords, the strip of sounds.
- **Shape**: the selected clip's frames over its waveform (region, loop, slices), a pad's sound and
  how it plays, or the layers with their key and morph zones.
- **Loop**: the loop board. Each column is a section with its own main video and layers, launched
  on the next bar; each cell is a recorded layer that loops as its own tile.
- **Post**: the takes, their timeline, the shape (9:16 with the apps' safe zones, 16:9, 1:1), the
  layout, the look of the tiles, and Export.

Eight knobs on the right always follow what you touched last, in pages (Quick, Voice, Filter,
Motion, Space for the Clip; others for pads, layers, the transport and the look). Their colour says
what they change (orange the tone, blue time, graphite space, violet the picture), and the value
pops up over the stage while you turn, with what the picture does. **More** opens every setting.

## Play it

- The keys **A to '** play C to F, **Z X** change octave, **C V** velocity, **Space** is the
  sustain pedal, **↑ ↓** bend, **Enter** records. They work in any keyboard layout (Hebrew too):
  the position of the key counts, not its letter.
- In Pads: **Z X C V / A S D F / Q W E R / 1 2 3 4** are the 16 pads, bottom row first.
- **MIDI** keyboards and controllers work in Chrome and Firefox. From Ableton Live, send a MIDI
  track to the IAC Driver (macOS) or loopMIDI (Windows); MIDI Clock start and stop record takes.
- **The camera** records a 2 to 5 second clip straight onto the instrument.
- **No video at hand?** It opens with a marimba already loaded, and the strip of sounds under the
  stage holds the whole pack: 26 CC0 recordings (VCSL), each with a 3D-rendered clip made for it.
- A **.mid** file dropped on the page becomes a take: export a whole song played by your clips.

## Run it

```bash
npm install
npm run dev
```

Vite serves it on http://localhost:5189. Chrome or Edge on a desktop is the target; Firefox works;
Safari has no Web MIDI (keys, mouse and camera only).

## How it is built

- **One AudioWorklet renders every voice** from mip-mapped samples (a pyramid of the clip, each level
  low-passed and halved), read with Hermite interpolation. Chrome's own buffer source pitches by
  linear interpolation with no anti-aliasing; three octaves up, this one is 46 dB cleaner.
- **The picture is a function of the sound.** The main thread keeps a book of every voice; each
  frame draws the voices audible when that frame reaches the eye. Live play, take playback and
  the export all draw from the same book, so they look the same.
- **Frames are decoded once** (Mediabunny and WebCodecs) into WebGL2 texture arrays, small and
  medium tiers, so 128 voices cost 128 texture reads, not 128 decoders. Fast notes blend several
  frames (motion blur); slow notes cross-fade neighbouring frames.
- **Takes are notes, not pixels.** Export replays them offline through the same engine, so any take
  renders in any layout and shape (16:9, 9:16, 1:1): H.264 + AAC, tagged BT.709, loudness
  normalised to −14 LUFS behind a limiter.
- Vite, React 19, TypeScript strict. The engine (`src/engine/`) has no React in it.

The research, design, formulas and the measurements behind each choice live in the workshop that
built it (Bar Builds), not in this repo.

## Checks

```bash
npx tsc -b && npx oxlint && npx vitest run && npm run build
node tools/check.mjs   # headless Chrome, end to end: first visit, play, knobs, layouts, pads, layers, looper, take, export, the four modes
```

`tools/check.mjs` needs Google Chrome and ffprobe, and test clips from `--media <dir>`. With
`--url <origin>` it checks a deployment instead of the local `dist/`.

Built by Bar Moshe.
