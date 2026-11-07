import { useEffect, useRef, useState } from 'react'
import { app } from '../engine/app'
import { useStore } from '../engine/store'
import { noteName } from '../engine/voice-math'
import { Seg } from './controls'
import { Dialog } from './Dialog'

/** Sample yourself (design §7): a short camera + mic clip straight onto the instrument. */
export function CameraDialog({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState<'2' | '3' | '5'>('3')
  const [left, setLeft] = useState<number | null>(null)
  const kind = useStore(app.store, (s) => s.kind)
  const pad = useStore(app.store, (s) => s.pads.selected)
  const videoTrack = useStore(app.store, (s) => s.tracks.find((t) => t.id === s.sel)?.kind === 'video')
  const [as, setAs] = useState<'sample' | 'take'>(videoTrack ? 'take' : 'sample')
  const take = useRef<{ rec: MediaRecorder; beat: number } | null>(null)

  useEffect(() => {
    let s: MediaStream | null = null
    navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((m) => { s = m; setStream(m); if (video.current) video.current.srcObject = m })
      .catch((e: Error) => setError(e.name === 'NotAllowedError' ? 'The camera or microphone was not allowed. Allow them in the address bar and try again.' : e.message))
    return () => s?.getTracks().forEach((t) => t.stop())
  }, [])

  const mime = () => ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
  /** A take along the song: the timeline plays with a count-in while the camera films, until Stop. */
  const recordTake = () => {
    if (!stream) return
    if (take.current) { take.current.rec.stop(); app.songStop(); return }
    const type = mime()
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const parts: Blob[] = []
    rec.ondataavailable = (e) => parts.push(e.data)
    rec.onstop = () => {
      const file = new File(parts, `Take ${new Date().toLocaleTimeString()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type: type.split(';')[0] || 'video/webm' })
      const beat = take.current?.beat ?? 0
      take.current = null
      onClose()
      void app.addRecording(file, beat)
    }
    app.store.set({ view: 'timeline' })
    app.songStart('timeline', true)
    rec.start()
    take.current = { rec, beat: app.beatAt(app.ctx.currentTime) }
    setLeft(-1)
  }

  const record = () => {
    if (!stream) return
    const type = mime()
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const parts: Blob[] = []
    rec.ondataavailable = (e) => parts.push(e.data)
    rec.onstop = () => {
      const ext = type.includes('mp4') ? 'mp4' : 'webm'
      const file = new File(parts, `Camera ${new Date().toLocaleTimeString()}.${ext}`, { type: type.split(';')[0] || 'video/webm' })
      onClose()
      void app.importFiles([file], kind === 'pads' ? { pad } : undefined)
    }
    let n = Number(seconds)
    setLeft(n)
    rec.start()
    const tick = setInterval(() => { n -= 1; setLeft(n); if (n <= 0) { clearInterval(tick); rec.stop() } }, 1000)
  }

  const where = kind === 'pads' ? `pad ${noteName(pad)}` : kind === 'layers' ? 'a new layer' : 'the Clip'
  return (
    <Dialog
      title="Record with the camera"
      onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        {as === 'take'
          ? <button type="button" className="btn rec" aria-pressed={left !== null} disabled={!stream} onClick={recordTake}><span className="dot" /> {left !== null ? 'Stop the take' : 'Record a take along the song'}</button>
          : <button type="button" className="btn rec" aria-pressed={left !== null} disabled={!stream || left !== null} onClick={record}><span className="dot" /> {left !== null ? `Recording… ${left}` : `Record ${seconds} s`}</button>}
      </>}
    >
      {error ? <p role="alert">{error}</p> : <video ref={video} autoPlay muted playsInline />}
      <Seg<'sample' | 'take'> label="Record" value={as} options={[['take', 'A take along the song'], ['sample', 'A short sample']]} onChange={setAs} />
      {as === 'sample' && <Seg label="Length" value={seconds} options={[['2', '2 s'], ['3', '3 s'], ['5', '5 s']]} onChange={setSeconds} />}
      <p className="muted" style={{ margin: 0 }}>{as === 'take'
        ? 'The song plays from the playhead after a bar of clicks; play or sing along on headphones, then Stop. The take lands on its own video track at the bar you started, in its own tile. Nothing leaves this computer.'
        : `Sing a note, hit something, say a word. It goes onto ${where}, tuned to its own pitch. Nothing leaves this computer.`}</p>
    </Dialog>
  )
}
