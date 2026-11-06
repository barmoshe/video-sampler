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

  useEffect(() => {
    let s: MediaStream | null = null
    navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((m) => { s = m; setStream(m); if (video.current) video.current.srcObject = m })
      .catch((e: Error) => setError(e.name === 'NotAllowedError' ? 'The camera or microphone was not allowed. Allow them in the address bar and try again.' : e.message))
    return () => s?.getTracks().forEach((t) => t.stop())
  }, [])

  const record = () => {
    if (!stream) return
    const type = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
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
        <button type="button" className="btn rec" aria-pressed={left !== null} disabled={!stream || left !== null} onClick={record}><span className="dot" /> {left !== null ? `Recording… ${left}` : `Record ${seconds} s`}</button>
      </>}
    >
      {error ? <p role="alert">{error}</p> : <video ref={video} autoPlay muted playsInline />}
      <Seg label="Length" value={seconds} options={[['2', '2 s'], ['3', '3 s'], ['5', '5 s']]} onChange={setSeconds} />
      <p className="muted" style={{ margin: 0 }}>Sing a note, hit something, say a word. It goes onto {where}, tuned to its own pitch. Nothing leaves this computer.</p>
    </Dialog>
  )
}
