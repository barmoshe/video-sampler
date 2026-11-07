import { app } from '../engine/app'
import { LOOKS } from '../engine/stage'
import { useStore } from '../engine/store'
import type { LayoutMode, StageAspect } from '../engine/types'
import { Lens } from './glass'
import { ui } from './ui'

const LAYOUTS: [LayoutMode, string][] = [['gallery', 'Gallery'], ['mosaic', 'Mosaic'], ['spotlight', 'Spotlight'], ['stack', 'Stack'], ['keys', 'Keys'], ['home', 'Pad grid']]
const ASPECTS: [StageAspect, string, string][] = [['16:9', '16:9', 'YouTube'], ['9:16', '9:16', 'Reels, TikTok, Shorts'], ['1:1', '1:1', 'Feed']]

/** A small drawing of each layout, so the choice reads at a glance. */
export function LayoutIcon({ mode }: { mode: LayoutMode }) {
  const r = (x: number, y: number, w: number, h: number, k: number) => <rect key={k} x={x} y={y} width={w} height={h} rx={1.2} />
  const shapes: Record<LayoutMode, [number, number, number, number][]> = {
    gallery: [[1, 1, 10, 6.5], [13, 1, 10, 6.5], [1, 9.5, 10, 6.5], [13, 9.5, 10, 6.5]],
    mosaic: [[1, 1, 13, 15], [16, 1, 7, 7], [16, 9.5, 7, 6.5]],
    spotlight: [[1, 1, 22, 11], [1, 13.5, 6.5, 2.5], [8.75, 13.5, 6.5, 2.5], [16.5, 13.5, 6.5, 2.5]],
    stack: [[1, 1, 22, 4.5], [1, 6.5, 22, 4.5], [1, 12, 22, 4]],
    keys: [[1, 4, 4, 9], [6, 4, 4, 9], [11, 4, 4, 9], [16, 4, 4, 9], [21, 4, 2, 9]],
    home: [[1, 1, 5, 3.4], [7, 1, 5, 3.4], [13, 1, 5, 3.4], [19, 1, 4, 3.4], [1, 5.2, 5, 3.4], [7, 5.2, 5, 3.4], [13, 5.2, 5, 3.4], [19, 5.2, 4, 3.4], [1, 9.4, 5, 3.4], [7, 9.4, 5, 3.4], [13, 9.4, 5, 3.4], [19, 9.4, 4, 3.4], [1, 13.6, 5, 2.4], [7, 13.6, 5, 2.4], [13, 13.6, 5, 2.4], [19, 13.6, 4, 2.4]],
  }
  return <svg viewBox="0 0 24 17" aria-hidden="true">{shapes[mode].map(([x, y, w, h], k) => r(x, y, w, h, k))}</svg>
}

const lookName = (look: unknown) => LOOKS.find((l) => JSON.stringify(l.look) === JSON.stringify(look))?.name ?? 'Custom'

/**
 * The picture's own controls, on the picture (ADR 0776): clear glass over the video, as Apple puts
 * controls over media. "Picture" selects the picture itself, and the inspector shows its layout and look.
 */
export function PictureBar() {
  const aspect = useStore(app.store, (s) => s.aspect)
  const trackLayout = useStore(app.store, (s) => s.trackLayout)
  const look = useStore(app.store, (s) => s.look)
  const picture = useStore(ui, (u) => u.picture)
  return (
    <Lens refract={false} className="picbar" radius={17} bezel={10} strength={22} role="toolbar" aria-label="The picture">
      <button type="button" className="picsel" aria-pressed={picture} onClick={() => ui.set({ picture: !picture, pick: null })} title="Select the picture: its layout and look in the inspector">
        <LayoutIcon mode={trackLayout} /><span>{LAYOUTS.find((l) => l[0] === trackLayout)?.[1]}, {lookName(look)}</span>
      </button>
      <span className="picsep" aria-hidden="true" />
      {ASPECTS.map(([a, l, t]) => <button key={a} type="button" className="picasp" aria-pressed={aspect === a} onClick={() => app.set('aspect', a)} title={`${l}: ${t}`}>{l}</button>)}
    </Lens>
  )
}

/** The inspector's page for the picture: how the tracks share the frame, how notes share a track, the look. */
export function PictureDetail() {
  const aspect = useStore(app.store, (s) => s.aspect)
  const kind = useStore(app.store, (s) => s.kind)
  const layout = useStore(app.store, (s) => s.layouts[s.kind])
  const trackLayout = useStore(app.store, (s) => s.trackLayout)
  const look = useStore(app.store, (s) => s.look)
  const safe = useStore(ui, (u) => u.safe)
  const lookId = LOOKS.find((l) => JSON.stringify(l.look) === JSON.stringify(look))?.id
  return (
    <div className="picdetail">
      <fieldset className="choice"><legend className="lab">The tracks share the frame</legend>
        {LAYOUTS.filter(([m]) => m === 'gallery' || m === 'mosaic' || m === 'spotlight' || m === 'stack').map(([m, l]) => <button key={m} type="button" aria-pressed={trackLayout === m} onClick={() => { app.set('trackLayout', m); app.stage?.layout.reset() }}><LayoutIcon mode={m} /><span>{l}</span></button>)}
      </fieldset>
      <fieldset className="choice"><legend className="lab">Notes share their track</legend>
        {LAYOUTS.filter(([m]) => m !== 'home' || kind === 'pads').map(([m, l]) => <button key={m} type="button" aria-pressed={layout === m} onClick={() => app.setLayout(m)}><LayoutIcon mode={m} /><span>{l}</span></button>)}
      </fieldset>
      <fieldset className="choice looks"><legend className="lab">Look</legend>
        {LOOKS.map((l) => <button key={l.id} type="button" aria-pressed={lookId === l.id} onClick={() => app.set('look', l.look)}>{l.name}</button>)}
      </fieldset>
      <fieldset className="choice"><legend className="lab">Shape</legend>
        {ASPECTS.map(([a, l, t]) => <button key={a} type="button" aria-pressed={aspect === a} onClick={() => app.set('aspect', a)} title={t}><span className={`frame f${a.replace(':', '')}`} />{l}</button>)}
        <button type="button" aria-pressed={safe} onClick={() => ui.set({ safe: !safe })} title="Show where the apps put their buttons and captions on a 9:16 frame">Safe zones</button>
      </fieldset>
    </div>
  )
}
