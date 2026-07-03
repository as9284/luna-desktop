import { useEffect, useRef } from 'react'
import { renderAsync } from 'docx-preview'

/** Renders a .docx with its real formatting (fonts, tables, images, page breaks) via docx-preview. */
export default function DocxView({ bytes, onRendered, onError }: { bytes: Uint8Array; onRendered: () => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    el.replaceChildren()
    renderAsync(bytes.slice(), el, undefined, { className: 'docx', inWrapper: true })
      .then(() => alive && onRendered())
      .catch((e) => alive && onError(e instanceof Error ? e.message : 'Could not render the Word document.'))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes])
  return <div ref={ref} className="docx-host" />
}
