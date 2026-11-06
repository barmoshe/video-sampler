import { useEffect, useRef, type ReactNode } from 'react'

/** A native modal dialog: Escape and the × close it. */
export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current!
    if (!d.open) d.showModal()
    const close = () => onClose()
    d.addEventListener('close', close)
    return () => { d.removeEventListener('close', close); if (d.open) d.close() }
  }, [onClose])
  return (
    <dialog ref={ref} aria-label={title}>
      <header>{title}<button type="button" className="x" aria-label="Close" onClick={() => ref.current?.close()}>×</button></header>
      <div className="body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  )
}
