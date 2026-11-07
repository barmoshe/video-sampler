// VIDAW's mark (ADR 0774): the split screen. A 16:9 screen holding three portrait tiles, the stage the
// app makes; flat, one colour, sharp corners. The wordmark is the name set in the interface's own face.

/** The mark alone: a screen of three tiles. Inherits the text colour. */
export function Mark({ size = 16, title }: { size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 64 36" height={size} width={(size * 64) / 36} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <path fill="currentColor" fillRule="evenodd" d="M0 0h64v36H0zM4 4v28h56V4z" />
      <rect x="8" y="8" width="14.67" height="20" fill="currentColor" />
      <rect x="24.67" y="8" width="14.67" height="20" fill="currentColor" />
      <rect x="41.33" y="8" width="14.67" height="20" fill="currentColor" />
    </svg>
  )
}

/** The lockup: the mark and the name. */
export function Logo({ size = 15 }: { size?: number }) {
  return (
    <span className="logo">
      <Mark size={size} />
      <span className="wordmark">VIDAW</span>
    </span>
  )
}
