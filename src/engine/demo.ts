// A demo clip made in the browser, so a first visit can play without a video at hand: a mouth that
// opens with a synthesised "ahh" at 220 Hz (A2 in the app's naming, where C3 is MIDI 60), so auto-root tunes it and C3 plays a real C.
// Nothing is downloaded and nothing carries anyone else's rights.
import { AudioBufferSource, BufferTarget, CanvasSource, canEncodeAudio, Mp4OutputFormat, Output } from 'mediabunny'

const W = 640, H = 360, FPS = 30, SECONDS = 4, FS = 48000, F0 = 220

/** The voice: a band-limited sawtooth through two vowel formants, with a little vibrato, and its envelope. */
function voice(): { samples: Float32Array<ArrayBuffer>; env: Float32Array<ArrayBuffer> } {
  const n = SECONDS * FS
  const raw = new Float32Array(n), env = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / FS
    const vib = t > 0.6 ? 1 + 0.006 * Math.sin(2 * Math.PI * 5.2 * t) : 1
    phase += (F0 * vib) / FS
    let s = 0
    for (let h = 1; h * F0 < 9000; h++) s += Math.sin(2 * Math.PI * h * phase) / h
    const a = Math.min(1, t / 0.04), r = t > SECONDS - 0.5 ? Math.max(0, (SECONDS - t) / 0.5) : 1
    env[i] = a * r * (0.85 + 0.15 * Math.sin(2 * Math.PI * 1.3 * t))
    raw[i] = s * env[i]
  }
  // two resonators (about 700 Hz and 1150 Hz): an open "ah"
  const out = new Float32Array(n)
  for (const [f, q, g] of [[700, 6, 1], [1150, 7, 0.7]] as const) {
    const w = (2 * Math.PI * f) / FS, al = Math.sin(w) / (2 * q), a0 = 1 + al
    const b0 = al / a0, b2 = -al / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - al) / a0
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < n; i++) {
      const y = b0 * raw[i] + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1; x1 = raw[i]; y2 = y1; y1 = y
      out[i] += y * g
    }
  }
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.7
  return { samples: out, env }
}

function draw(g: OffscreenCanvasRenderingContext2D, t: number, level: number) {
  const hue = (t * 40) % 360
  g.fillStyle = '#0d0d10'
  g.fillRect(0, 0, W, H)
  // a moving horizon so every frame differs (speed changes are visible)
  for (let k = 0; k < 12; k++) {
    const x = ((k * 80 + t * 160) % (W + 80)) - 40
    g.fillStyle = `hsl(${(hue + k * 30) % 360} 70% ${18 + (k % 3) * 6}%)`
    g.fillRect(x, H - 70, 46, 70)
  }
  // the face: two eyes and a mouth that opens with the sound
  const cx = W / 2, cy = H / 2 - 10
  g.fillStyle = `hsl(${hue} 80% 62%)`
  g.beginPath(); g.arc(cx, cy, 120, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#111'
  const blink = (t % 1.7) < 0.08 ? 2 : 16
  g.fillRect(cx - 52, cy - 50, 22, blink); g.fillRect(cx + 30, cy - 50, 22, blink)
  g.beginPath(); g.ellipse(cx, cy + 40, 50, 6 + 46 * level, 0, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#f2efe6'
  g.font = '600 18px ui-monospace, Menlo, monospace'
  g.fillText('ahh · A2', 22, 34)
}

/** Renders the demo clip to an MP4 File (about 1-3 s on a laptop). */
export async function makeDemoClip(onProgress?: (p: number) => void): Promise<File> {
  const { samples, env } = voice()
  const canvas = new OffscreenCanvas(W, H), g = canvas.getContext('2d')!
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 2e6, keyFrameInterval: 1 })
  const audio = new AudioBufferSource({ codec: (await canEncodeAudio('aac')) ? 'aac' : 'opus', bitrate: 160e3 })
  output.addVideoTrack(video, { frameRate: FPS })
  output.addAudioTrack(audio)
  await output.start()
  const buf = new AudioBuffer({ length: samples.length, numberOfChannels: 2, sampleRate: FS })
  buf.copyToChannel(samples, 0); buf.copyToChannel(samples, 1)
  await audio.add(buf)
  const frames = SECONDS * FPS
  for (let k = 0; k < frames; k++) {
    const t = k / FPS
    draw(g, t, env[Math.min(env.length - 1, Math.round(t * FS))])
    await video.add(t, 1 / FPS)
    if (k % 15 === 0) onProgress?.(k / frames)
  }
  await output.finalize()
  return new File([target.buffer!], 'Demo voice (A2).mp4', { type: 'video/mp4' })
}
