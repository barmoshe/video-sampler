import { Dialog } from './Dialog'

const CODE: [string, string, string][] = [
  ['Mediabunny', 'MPL-2.0, used unmodified (source: github.com/Vanilagy/mediabunny)', 'https://github.com/Vanilagy/mediabunny'],
  ['pitchy', '0BSD', 'https://github.com/ianprime0509/pitchy'],
  ['@tonejs/midi', 'MIT', 'https://github.com/Tonejs/Midi'],
  ['React', 'MIT', 'https://github.com/facebook/react'],
]
const KEYS: [string, string][] = [
  ['M', 'the computer keyboard plays notes, or not (as in Live)'],
  ["A to '", 'play the keys (Z X octave, C V velocity)'], ['Z X C V, A S D F, Q W E R, 1 2 3 4', 'the pads, bottom row first'],
  ['Space', 'play or stop the song'], ['Tab', 'the board or the timeline'], ['↑ ↓', 'pitch bend'], ['Enter or `', 'record into the song'], ['Shift+Enter', 'capture what you just played as a take'],
  ['1 to 8', 'launch a scene (Clip and Layers)'], ['Option+1, 2, 3', 'show or hide the library, the inspector, the song'], ['Option+4', 'the stage alone'], ['⌘Z, ⇧⌘Z', 'undo, redo'],
]
const FONTS: [string, string][] = [['Instrument Sans', 'SIL Open Font License 1.1']]

/** What the app is, where your clips live, and the licences it ships under. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="About VIDAW" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      <p style={{ margin: 0 }}>VIDAW is a video DAW: every key plays a clip, picture and sound repitched together; every track is a tile in the split screen; the song exports as one MP4. Made by Bar Moshe.</p>
      <p className="muted" style={{ margin: 0 }}>Your clips stay in this browser. Nothing is uploaded. Clearing the browser's data removes the saved project, so save a project file to keep one.</p>
      <fieldset className="field"><legend className="lab">Keys</legend>
        <dl className="keylist">{KEYS.map(([k, d]) => <div key={k}><dt>{k}</dt><dd>{d}</dd></div>)}</dl>
      </fieldset>
      <fieldset className="field"><legend className="lab">Code it uses</legend>
        <ul className="credits">
          {CODE.map(([n, l, u]) => <li key={n}><a href={u} target="_blank" rel="noreferrer">{n}</a>: {l}</li>)}
        </ul>
      </fieldset>
      <fieldset className="field"><legend className="lab">Fonts</legend>
        <ul className="credits">{FONTS.map(([n, l]) => <li key={n}>{n}: {l}</li>)}</ul>
      </fieldset>
      <fieldset className="field"><legend className="lab">Built-in sounds</legend>
        <p className="muted" style={{ margin: 0 }}>The library's recordings are from the Versilian Community Sample Library (VCSL), CC0, with artwork made for them. Each clip's source is listed in <a href="/library/CREDITS.md" target="_blank" rel="noreferrer">the credits</a>.</p>
      </fieldset>
      <p className="muted" style={{ margin: 0 }}>Source code: <a href="https://github.com/barmoshe/video-sampler" target="_blank" rel="noreferrer">github.com/barmoshe/video-sampler</a></p>
    </Dialog>
  )
}
