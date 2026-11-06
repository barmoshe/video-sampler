import { useRef } from 'react'
import { app } from '../engine/app'
import { PAD_BASE, type PadChain } from '../engine/instruments'
import { PAD_LABEL } from '../engine/input'
import { useStore } from '../engine/store'
import { noteName } from '../engine/voice-math'
import { ClipList } from './ClipPanel'
import { Check, Section, Seg, Slider } from './controls'
import { ms, rgb } from './format'

export function PadsPanel({ onCamera }: { onCamera: () => void }) {
  const pads = useStore(app.store, (s) => s.pads)
  const clips = useStore(app.store, (s) => s.clips)
  const active = useStore(app.store, (s) => s.active)
  const velocity = useStore(app.store, (s) => s.velocity)
  const file = useRef<HTMLInputElement>(null)
  const base = PAD_BASE + pads.bank * 16
  const sel = pads.chains.find((c) => c.note === pads.selected)
  const set = (p: Partial<PadChain>) => app.setPad(pads.selected, p)

  // the 4×4 block is laid out like the keys: bottom row = the bank's first four pads
  const order = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3]
  return (
    <>
      <Section title="Pads" action={<button type="button" className="btn" onClick={onCamera}>Camera</button>}>
        <fieldset className="banks"><legend className="sr">Bank</legend>
          {Array.from({ length: 8 }, (_, b) => <button key={b} type="button" aria-pressed={pads.bank === b} title={`Pads ${noteName(PAD_BASE + b * 16)} to ${noteName(PAD_BASE + b * 16 + 15)}`} onClick={() => app.setPads({ bank: b, selected: PAD_BASE + b * 16 })}>{'ABCDEFGH'[b]}</button>)}
        </fieldset>
        <div className="padgrid">
          {order.map((i) => {
            const note = base + i
            const ch = pads.chains.find((c) => c.note === note)
            const clip = clips.find((c) => c.id === ch?.clipId)
            return (
              <button
                key={note}
                type="button"
                className={`pad ${active.includes(note) ? 'on' : ''}`}
                aria-pressed={pads.selected === note}
                aria-label={`Pad ${noteName(note)}${clip ? `, ${clip.name}` : ', empty'}`}
                onPointerDown={() => { app.setPads({ selected: note }); if (clip) app.handlers.noteOn(note, velocity, performance.now(), 'keys') }}
                onPointerUp={() => clip && app.handlers.noteOff(note, performance.now())}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files.length) void app.importFiles([...e.dataTransfer.files].slice(0, 1), { pad: note }) }}
              >
                {clip && <span className="fill" style={{ background: `${rgb(clip.poster)} url(${clip.thumb}) center / cover` }} />}
                <span>{PAD_LABEL[i]}</span>
                <span>{clip ? clip.name.slice(0, 9) : noteName(note)}</span>
              </button>
            )
          })}
        </div>
        <p className="muted" style={{ margin: '10px 0 0' }}>Drop a video on a pad, or select a pad and add a clip. Keys Z X C V are the bottom row.</p>
      </Section>

      <Section title={`Pad ${noteName(pads.selected)}`}>
        <input ref={file} type="file" accept="video/*" hidden onChange={(e) => { if (e.target.files?.length) void app.importFiles([e.target.files[0]], { pad: pads.selected }); e.target.value = '' }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" className="btn" onClick={() => file.current?.click()}>Load a video</button>
          {sel?.clipId && <button type="button" className="btn" onClick={() => set({ clipId: null })}>Clear</button>}
        </div>
        {clips.length > 0 && <ClipList selected={sel?.clipId ?? null} onPick={(id) => set({ clipId: id })} />}
        {sel?.clipId && (
          <div className="grid2" style={{ marginTop: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Seg label="Mode" value={sel.mode} options={[['oneshot', 'One-Shot'], ['classic', 'Hold (loop)']]} onChange={(mode) => set({ mode })} />
            </div>
            <Slider label="Pitch (play note)" value={sel.playNote} min={36} max={84} format={(v) => `${noteName(v)}${v === 60 ? ' (original)' : ''}`} onChange={(playNote) => set({ playNote })} />
            <Slider label="Choke group" value={sel.choke} min={0} max={16} format={(v) => (v ? String(v) : 'none')} onChange={(choke) => set({ choke })} />
            <Slider label="Volume" value={sel.volume} min={-36} max={6} format={(v) => `${v} dB`} onChange={(volume) => set({ volume })} />
            <Slider label="Pan" value={sel.pan} min={-1} max={1} step={0.05} format={(v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} onChange={(pan) => set({ pan })} />
            <Slider label="Loudness trim" value={sel.trim} min={-12} max={12} step={0.5} format={(v) => `${v.toFixed(1)} dB`} onChange={(trim) => set({ trim })} />
            <Slider label="Release" value={sel.env.r} min={0.03} max={4} step={0.01} format={ms} onChange={(r) => set({ env: { ...sel.env, r } })} />
            <Slider label="Delay send" value={sel.sends?.delay ?? 0} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={(delay) => set({ sends: { delay, reverb: sel.sends?.reverb ?? 0 } })} />
            <Slider label="Reverb send" value={sel.sends?.reverb ?? 0} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={(reverb) => set({ sends: { delay: sel.sends?.delay ?? 0, reverb } })} />
            <Check label="Tune to nearest note" checked={sel.tune} onChange={(tune) => set({ tune })} />
            <Check label="Mute" checked={sel.mute} onChange={(mute) => set({ mute })} />
            <Check label="Solo" checked={sel.solo} onChange={(solo) => set({ solo })} />
          </div>
        )}
      </Section>
      <Section title="Kit">
        <Slider label="Voices" value={pads.voices} min={1} max={128} onChange={(voices) => app.setPads({ voices })} />
        <p className="muted" style={{ margin: '10px 0 0' }}>Pads in the same choke group cut each other, sound and picture. Pads are levelled to the same loudness when loaded.</p>
      </Section>
    </>
  )
}
