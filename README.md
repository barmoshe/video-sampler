# VIDAW

A video DAW in the browser. Every key plays a clip at its own pitch, picture and sound together: a
higher note sings higher and moves faster. Every track is a tile in a live split screen, so a song is
a music video as you make it. Jam on the board, arrange on the timeline, and export the song as one
MP4 for Reels, TikTok or YouTube.

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

The stage on the left, the song on the right, a deck below.

- **The song** has two views of the same tracks (Tab switches). The **board**: tracks as rows, scenes
  as columns, each cell a loop; a scene launches on the next bar, and an empty cell records live, pass
  after pass. The **timeline**: the song on bars; drag a clip to move it, its right edge to stretch it;
  scenes go onto it with "Add to song".
- **Tracks** come in four kinds: instrument (a Clip, Pads or Layers instrument and its notes), video
  (takes of yourself filmed along the song, played as recorded), backing (a video or song under
  everything) and picture (cues that change the layout and the look over time).
- **Each track is a tile.** The stage is laid out by track first, side by side on a landscape frame and
  stacked on a portrait one, and a track's notes flash inside its own region.
- **The deck** has four modes (Option+1 to 4): **Play** (the selected track's keys or pads, scale and
  chords, the strip of sounds), **Shape** (the sample editor, or a picked clip's notes in a piano roll),
  **Mix** (a strip under each track's tile: fader, pan, mute, solo) and **Post** (takes, the shape with
  the apps' safe zones, the layouts, the look, and Export).

Eight knobs on the right follow what you touched last, in pages, and light up in the selected track's
colour; the value pops up over the stage while you turn, with what the picture does. **More** opens
every setting. Light by default; dark (or like your Mac) in Settings.

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
