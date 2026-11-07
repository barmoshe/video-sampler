import { Dialog } from './Dialog'

const CODE: [string, string, string][] = [
  ['Mediabunny', 'MPL-2.0, used unmodified (source: github.com/Vanilagy/mediabunny)', 'https://github.com/Vanilagy/mediabunny'],
  ['pitchy', '0BSD', 'https://github.com/ianprime0509/pitchy'],
  ['@tonejs/midi', 'MIT', 'https://github.com/Tonejs/Midi'],
  ['React', 'MIT', 'https://github.com/facebook/react'],
]
const FONTS: [string, string][] = [['Archivo', 'SIL Open Font License 1.1'], ['JetBrains Mono', 'SIL Open Font License 1.1']]

/** What the app is, where your clips live, and the licences it ships under. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="About and licences" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      <p style={{ margin: 0 }}>A video sampler: every key plays a clip, picture and sound repitched together, and every note you hold joins the picture. Made by Bar Moshe.</p>
      <p className="muted" style={{ margin: 0 }}>Your clips stay in this browser. Nothing is uploaded. Clearing the browser's data removes the saved project, so save a project file to keep one.</p>
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
