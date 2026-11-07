// Liquid Glass for VIDAW's interface (ADR 0775). Two pieces the CSS cannot do alone:
// - the wallpaper: the mark's three tiles, large and sharp behind the window. It is not glass (Bar: "the
//   actual background itself shouldn't be liquid glass"); it is what the glass has to bend and tint, since
//   glass over a flat colour reads as a plain white pill ("now it looks like there isn't liquid glass at all");
// - the lens: real refraction for glass that floats, from a displacement map computed for the element's
//   exact size (Snell-like bending at the bezel, flat in the middle). Chromium only: Safari and Firefox
//   accept `backdrop-filter: url()` and then draw nothing, so it is gated by engine.
import { useEffect, useId, useRef, type ReactNode } from 'react'

/** The window's wallpaper: three tiles of the split-screen mark, in the brand's first three track colours. */
export function Wallpaper() {
  return <div className="wall" aria-hidden="true"><i /><i /><i /></div>
}

const chromium = typeof navigator !== 'undefined' && !!(navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands?.some((b) => /Chromium/.test(b.brand))
const reduced = () => typeof matchMedia !== 'undefined' && (matchMedia('(prefers-reduced-transparency: reduce)').matches || matchMedia('(prefers-contrast: more)').matches)

/**
 * A displacement map for a rounded rectangle of w×h px and corner radius r: inside a bezel of b px the
 * picture is pulled outward along the edge's normal (strongest at the rim, a convex lens profile), and
 * the middle is left alone. Red is x, green is y, 128 is no displacement.
 */
function lensMap(w: number, h: number, r: number, b: number): string {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  const img = g.createImageData(w, h), d = img.data
  r = Math.min(r, w / 2, h / 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // signed distance to the rounded rectangle's edge (negative inside) and the outward normal
      const px = x + 0.5 - w / 2, py = y + 0.5 - h / 2
      const qx = Math.abs(px) - (w / 2 - r), qy = Math.abs(py) - (h / 2 - r)
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0)
      const dist = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
      let nx = 0, ny = 0
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l } else if (qx > qy) nx = 1; else ny = 1
      nx *= Math.sign(px); ny *= Math.sign(py)
      const inner = -dist // px from the edge, inward
      const k = inner < b ? Math.pow(1 - Math.max(0, inner) / b, 2) : 0
      const i = (y * w + x) * 4
      d[i] = 128 - nx * 127 * k; d[i + 1] = 128 - ny * 127 * k; d[i + 2] = 128; d[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return c.toDataURL()
}

/**
 * Glass with a lens, for what floats: wraps its children in an element whose backdrop is refracted at the
 * rim, then frosted (`frost`). Elsewhere (Safari, Firefox, reduced transparency, or `refract={false}` over
 * the live video) it is frosted only.
 */
export function Lens({ className = '', radius = 12, bezel = 12, strength = 28, frost = 'blur(3px) saturate(160%)', refract = true, children, as = 'div', ...rest }: { className?: string; radius?: number; bezel?: number; strength?: number; frost?: string; refract?: boolean; children: ReactNode; as?: 'div' | 'output' | 'fieldset' } & Record<string, unknown>) {
  const id = `lens${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const el = useRef<HTMLElement>(null)
  const img = useRef<SVGFEImageElement>(null)
  useEffect(() => {
    const node = el.current
    // over the live video the backdrop changes every frame, and an SVG filter there costs the stage frames: frost only
    if (!node || !refract || !chromium || reduced()) return
    let last = ''
    const fit = () => {
      const w = Math.round(node.offsetWidth), h = Math.round(node.offsetHeight)
      const key = `${w}x${h}`
      if (!w || !h || key === last || !img.current) return
      last = key
      img.current.setAttribute('href', lensMap(w, h, radius, bezel))
      img.current.setAttribute('width', String(w)); img.current.setAttribute('height', String(h))
      node.style.setProperty('backdrop-filter', `url(#${id}) ${frost}`)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(node)
    return () => ro.disconnect()
  }, [id, radius, bezel, frost, refract])
  const Tag = as as 'div'
  return (
    <Tag ref={el as React.RefObject<HTMLDivElement>} className={`lens ${className}`} {...rest}>
      {children}
      <svg className="lensdefs" aria-hidden="true" focusable="false">
        <filter id={id} x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feImage ref={img} x="0" y="0" result="map" preserveAspectRatio="none" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={strength} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
    </Tag>
  )
}
