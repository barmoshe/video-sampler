// What this browser can do (production.md §3 K): the app needs WebCodecs, AudioWorklet and WebGL2;
// MIDI and saving are extras. Safari has no Web MIDI; WebCodecs arrived in Safari 26 and Firefox 130.

export interface Support { webcodecs: boolean; worklet: boolean; webgl2: boolean; midi: boolean; storage: boolean }

export function support(): Support {
  const g = globalThis as unknown as Record<string, unknown>
  let webgl2 = false
  try { webgl2 = !!document.createElement('canvas').getContext('webgl2') } catch { /* none */ }
  return {
    webcodecs: typeof g.VideoDecoder === 'function' && typeof g.AudioDecoder === 'function',
    worklet: typeof g.AudioWorkletNode === 'function',
    webgl2,
    midi: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
    storage: typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory,
  }
}

/** The one sentence to show when something the app needs is missing, or null. */
export function blocking(s: Support): string | null {
  const need = [!s.webcodecs && 'video decoding (WebCodecs)', !s.worklet && 'AudioWorklet', !s.webgl2 && 'WebGL2'].filter(Boolean)
  if (!need.length) return null
  return `This browser lacks ${need.join(', ')}. The video sampler needs a recent Chrome, Edge, Firefox (130+) or Safari (26+).`
}

export const MIDI_NOTE = 'MIDI keyboards work in Chrome, Edge and Firefox. Safari has no Web MIDI; the computer keys and the on-screen keys still play.'
