import { useCallback, useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Maximize2, FolderOpen, X, Code2, Eye } from 'lucide-react'
import PdfView from './doc/PdfView'
import Markdown from '../components/Markdown'
import './doc/doc.css'

interface Loaded {
  bytes: Uint8Array
  mime: string
  name: string
  kind: 'pdf' | 'image' | 'text'
  url: string | null
  text: string | null
}

/**
 * A focused, in-app preview of a file Luna just created — opened from its chat card. Reuses the
 * PDF renderer the Atlas viewer uses; images and text render inline. Reveal / open-in-default-app
 * are one click away for anything richer.
 */
export default function FilePreview({ path, onClose }: { path: string; onClose: () => void }) {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [rawView, setRawView] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    let url: string | null = null
    setData(null)
    setError(null)
    ;(async () => {
      const res = await window.api?.files?.readOutput(path).catch(() => undefined)
      if (!alive) return
      if (!res?.ok || !res.bytes) {
        setError(res?.error ?? 'Could not open the file.')
        return
      }
      const bytes = res.bytes instanceof Uint8Array ? res.bytes : new Uint8Array(res.bytes as ArrayBuffer)
      const kind = (res.kind ?? 'text') as Loaded['kind']
      if (kind === 'image') url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: res.mime || 'application/octet-stream' }))
      const text = kind === 'text' ? new TextDecoder().decode(bytes) : null
      setData({ bytes, mime: res.mime ?? '', name: res.name ?? path, kind, url, text })
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const reveal = () => window.api?.files?.reveal(path)
  const zoom = (d: number) => setScale((s) => Math.min(4, Math.max(0.4, Math.round((s + d) * 10) / 10)))
  const noop = useCallback(() => {}, [])
  const canZoom = data?.kind === 'pdf' || data?.kind === 'image'
  const isMarkdown = data?.kind === 'text' && /\.(md|markdown|mdx)$/i.test(data?.name ?? path)

  return (
    <div className="fp-veil" onMouseDown={onClose}>
      <div className="fp-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fp-bar">
          <span className="fp-name" title={path}>{data?.name ?? 'Preview'}</span>
          <div className="fp-tools">
            {canZoom && (
              <>
                <button className="fp-btn" onClick={() => zoom(-0.2)} title="Zoom out"><ZoomOut size={15} /></button>
                <span className="fp-zoom">{Math.round(scale * 100)}%</span>
                <button className="fp-btn" onClick={() => zoom(0.2)} title="Zoom in"><ZoomIn size={15} /></button>
                <button className="fp-btn" onClick={() => setScale(1)} title="Fit"><Maximize2 size={14} /></button>
              </>
            )}
            {isMarkdown && (
              <button
                className={'fp-btn' + (rawView ? '' : ' fp-btn--on')}
                onClick={() => setRawView((r) => !r)}
                aria-pressed={!rawView}
                title={rawView ? 'Show formatted markdown' : 'Show raw source'}
              >
                {rawView ? <Eye size={15} /> : <Code2 size={15} />}
              </button>
            )}
            <button className="fp-btn" onClick={reveal} title="Reveal in folder"><FolderOpen size={15} /></button>
            <button className="fp-btn" onClick={onClose} title="Close (Esc)"><X size={16} /></button>
          </div>
        </div>

        <div className="fp-scroll scroll-y" ref={scrollRef}>
          {error ? (
            <div className="fp-empty">
              {error}
              <button className="fp-fallback" onClick={reveal}>Reveal in folder</button>
            </div>
          ) : !data ? (
            <div className="fp-empty">Loading…</div>
          ) : data.kind === 'pdf' ? (
            <PdfView
              bytes={data.bytes}
              scale={scale}
              scrollRef={scrollRef}
              onCount={noop}
              onPage={noop}
              registerGoto={noop}
              onRendered={noop}
              onError={setError}
            />
          ) : data.kind === 'image' && data.url ? (
            <div className="fp-image-host">
              <img className="fp-image" src={data.url} alt={data.name} style={scale === 1 ? undefined : { width: `${scale * 100}%`, maxWidth: 'none' }} />
            </div>
          ) : isMarkdown && !rawView ? (
            <div className="fp-md">
              <Markdown content={data.text ?? ''} />
            </div>
          ) : (
            <pre className="fp-text">{data.text}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
