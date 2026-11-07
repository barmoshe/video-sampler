// Drawn icons (the brand pass replaces text glyphs like ▶ ● ⚙ ×): one 16-unit grid, one stroke weight,
// currentColor, so each icon takes the colour and size of the control it sits in.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }
const Svg = ({ size = 16, children, ...p }: P) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>{children}</svg>
)

export const Play = (p: P) => <Svg {...p}><path d="M5 3.2v9.6L12.6 8z" fill="currentColor" stroke="none" /></Svg>
export const Stop = (p: P) => <Svg {...p}><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none" /></Svg>
export const Rec = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="4.2" fill="currentColor" stroke="none" /></Svg>
export const Undo = (p: P) => <Svg {...p}><path d="M5.5 3.5 2.5 6.5l3 3" /><path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" /></Svg>
export const Redo = (p: P) => <Svg {...p}><path d="m10.5 3.5 3 3-3 3" /><path d="M13 6.5H6.5a3.5 3.5 0 0 0 0 7H9" /></Svg>
export const Gear = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" /></Svg>
export const Close = (p: P) => <Svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></Svg>
export const Plus = (p: P) => <Svg {...p}><path d="M8 3v10M3 8h10" /></Svg>
export const Camera = (p: P) => <Svg {...p}><rect x="1.8" y="4.2" width="9.2" height="7.6" rx="1.6" /><path d="m11 7 3.2-1.8v5.6L11 9" /></Svg>
export const Metronome = (p: P) => <Svg {...p}><path d="M6 2.2h4l2.6 11.6H3.4z" /><path d="m8 10.5 3.6-6" /></Svg>
export const Library = (p: P) => <Svg {...p}><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></Svg>
export const Midi = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="6" /><circle cx="5" cy="8" r=".6" fill="currentColor" /><circle cx="11" cy="8" r=".6" fill="currentColor" /><circle cx="8" cy="5" r=".6" fill="currentColor" /><circle cx="6" cy="5.9" r=".6" fill="currentColor" /><circle cx="10" cy="5.9" r=".6" fill="currentColor" /></Svg>
export const Expand = (p: P) => <Svg {...p}><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" /></Svg>
export const Export = (p: P) => <Svg {...p}><path d="M8 10V2.5M5 5.5l3-3 3 3" /><path d="M2.5 9.5v3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" /></Svg>
