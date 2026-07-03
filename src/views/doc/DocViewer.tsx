import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Maximize2, ChevronUp, ChevronDown, Search, ExternalLink, FolderOpen, X } from 'lucide-react'
import Markdown from '../../components/Markdown'
import { Modal, Button } from '../../ui'
import { docKind, markMatches } from './helpers'
import { useBytes } from './useBytes'
import PdfView from './PdfView'
import DocxView from './DocxView'
import SheetView from './SheetView'
import SlideView from './SlideView'
import './doc.css'

/* ---------------- simple text-based viewers ---------------- */

const ImageView = ({ url, scale }: { url: string; scale: number }) => (
  <div className="image-host">
    <img className="doc-image" src={url} alt="" style={scale === 1 ? undefined : { width: `${scale * 100}%`, maxWidth: 'none', maxHeight: 'none' }} />
  </div>
)

const CodeView = memo(({ body, lang }: { body: string; lang: string }) => (
  <div className="doc-pad">
    <Markdown content={'````' + lang + '\n' + body + '\n````'} />
  </div>
))
const MarkdownView = memo(({ body }: { body: string }) => (
  <div className="doc-pad doc-prose">
    <Markdown content={body} />
  </div>
))
const TextView = memo(({ body }: { body: string }) => <pre className="doc-text">{body}</pre>)

function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ } else q = false
      } else cur += ch
    } else if (ch === '"') q = true
    else if (ch === delim) { row.push(cur); cur = '' }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (ch !== '\r') cur += ch
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row) }
  return rows
}

const CsvView = memo(({ body, delim }: { body: string; delim: string }) => {
  const rows = parseDelimited(body, delim).slice(0, 3000)
  if (!rows.length) return <div className="doc-empty">Empty file.</div>
  const [head, ...rest] = rows
  return (
    <div className="sheet-host">
      <div className="sheet-scroll scroll-y">
        <table className="sheet-grid csv-grid">
          <thead>
            <tr>
              <th className="sheet-corner" />
              {head.map((h, i) => (
                <th key={i} className="sheet-colhead csv-head">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rest.map((r, ri) => (
              <tr key={ri}>
                <th className="sheet-rowhead">{ri + 1}</th>
                {head.map((_, ci) => <td key={ci}>{r[ci] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})

/* ---------------- orchestrator ---------------- */

export default function DocViewer({ item }: { item: AtlasItem }) {
  const kind = docKind(item)
  const needsBytes = kind === 'pdf' || kind === 'image' || kind === 'docx'
  const needsModel = kind === 'sheet' || kind === 'slides'

  const bytes = useBytes(item.id, needsBytes)
  const [model, setModel] = useState<DocModel | null>(null)
  const [modelErr, setModelErr] = useState<string | null>(null)
  const [renderErr, setRenderErr] = useState<string | null>(null)

  useEffect(() => {
    if (!needsModel) return
    let alive = true
    setModel(null)
    setModelErr(null)
    window.api?.atlas.docModel(item.id).then((r) => {
      if (!alive) return
      if (r?.ok && r.model) setModel(r.model)
      else setModelErr(r?.error ?? 'Could not parse this file.')
    })
    return () => {
      alive = false
    }
  }, [item.id, needsModel])

  // one-time-per-open heads-up that .pptx rendering is experimental (suppressible)
  const [pptxWarn, setPptxWarn] = useState(false)
  useEffect(() => {
    setPptxWarn(kind === 'slides' && localStorage.getItem('luna.pptxWarnHidden') !== '1')
  }, [kind, item.id])

  // ---- shared toolbar state ----
  const scrollRef = useRef<HTMLDivElement>(null)
  const gotoRef = useRef<(n: number) => void>(() => {})
  const marksRef = useRef<HTMLElement[]>([])
  const queryRef = useRef('')
  const [scale, setScale] = useState(1)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchIdx, setMatchIdx] = useState(-1)
  const [matchCount, setMatchCount] = useState(0)
  queryRef.current = query

  const canZoom = kind === 'pdf' || kind === 'image'
  const canPage = (kind === 'pdf' || kind === 'slides') && pageCount > 0
  const canFind = kind !== 'image'

  const focusMark = (i: number) => {
    marksRef.current.forEach((m) => m.classList.remove('current'))
    const el = marksRef.current[i]
    if (el) {
      el.classList.add('current')
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }
  // stable: reads the live query from a ref so pdf pages rendering late can re-run it.
  // INVARIANT: markMatches mutates the DOM inside the (React-rendered) text viewers directly, so
  // those viewers MUST stay memoized on stable props and MUST NOT re-render while marks are present
  // (item.body is value-stable, model keeps its ref, nav callbacks are useCallback). If any of
  // those becomes reactive, React will reconcile over injected <mark>s and throw removeChild.
  const runFind = useCallback(() => {
    const root = scrollRef.current
    if (!root) return
    const marks = markMatches(root, queryRef.current)
    marksRef.current = marks
    setMatchCount(marks.length)
    setMatchIdx(marks.length ? 0 : -1)
    if (marks.length) requestAnimationFrame(() => focusMark(0))
  }, [])
  useEffect(() => {
    runFind()
  }, [query, runFind])
  const onRendered = useCallback(() => {
    if (queryRef.current) runFind()
  }, [runFind])
  const step = (dir: number) => {
    if (!matchCount) return
    const ni = (matchIdx + dir + matchCount) % matchCount
    setMatchIdx(ni)
    focusMark(ni)
  }

  const onCount = useCallback((n: number) => setPageCount(n), [])
  const onPage = useCallback((n: number) => setPage(n), [])
  const registerGoto = useCallback((fn: (n: number) => void) => {
    gotoRef.current = fn
  }, [])

  // Ctrl/Cmd+F opens find; Esc closes
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && canFind) {
        e.preventDefault()
        setFindOpen(true)
        requestAnimationFrame(() => el.querySelector<HTMLInputElement>('.doc-find-input')?.focus())
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false)
        setQuery('')
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [canFind, findOpen])

  const zoom = (d: number) => setScale((s) => Math.min(4, Math.max(0.4, Math.round((s + d) * 10) / 10)))

  const reveal = () => item.meta?.sourcePath && window.api?.files?.reveal(item.meta.sourcePath)
  const openExternal = () => window.api?.atlas.openFile(item.id)

  const error = bytes.error || modelErr || renderErr
  const loading = (needsBytes && bytes.loading) || (needsModel && !model && !modelErr)

  return (
    <div className="doc-viewer" ref={rootRef}>
      <div className="doc-toolbar">
        <div className="doc-tool-group">
          <span className="doc-kind">{(item.meta?.fileType || kind).toUpperCase()}</span>
          {kind === 'slides' && <span className="doc-hint" title="Best-effort slide rendering">preview</span>}
        </div>

        {canPage && (
          <div className="doc-tool-group">
            <button className="doc-btn" onClick={() => gotoRef.current(page - 1)} disabled={page <= 1} title="Previous">
              <ChevronUp size={15} />
            </button>
            <span className="doc-pageno">
              {page} / {pageCount}
            </span>
            <button className="doc-btn" onClick={() => gotoRef.current(page + 1)} disabled={page >= pageCount} title="Next">
              <ChevronDown size={15} />
            </button>
          </div>
        )}

        {canZoom && (
          <div className="doc-tool-group">
            <button className="doc-btn" onClick={() => zoom(-0.2)} title="Zoom out">
              <ZoomOut size={15} />
            </button>
            <span className="doc-zoom">{Math.round(scale * 100)}%</span>
            <button className="doc-btn" onClick={() => zoom(0.2)} title="Zoom in">
              <ZoomIn size={15} />
            </button>
            <button className="doc-btn" onClick={() => setScale(1)} title="Fit">
              <Maximize2 size={14} />
            </button>
          </div>
        )}

        <div className="doc-tool-group doc-tool-right">
          {canFind && (
            <>
              {findOpen ? (
                <div className="doc-find-box">
                  <Search size={13} className="doc-find-ic" />
                  <input
                    className="doc-find-input"
                    placeholder="Find"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
                    }}
                  />
                  <span className="doc-find-count">{matchCount ? `${matchIdx + 1}/${matchCount}` : query ? '0' : ''}</span>
                  <button className="doc-btn" onClick={() => step(-1)} disabled={!matchCount} title="Previous match">
                    <ChevronUp size={14} />
                  </button>
                  <button className="doc-btn" onClick={() => step(1)} disabled={!matchCount} title="Next match">
                    <ChevronDown size={14} />
                  </button>
                  <button className="doc-btn" onClick={() => { setFindOpen(false); setQuery('') }} title="Close">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button className="doc-btn" onClick={() => setFindOpen(true)} title="Find (Ctrl+F)">
                  <Search size={15} />
                </button>
              )}
            </>
          )}
          {item.meta?.sourcePath && (
            <button className="doc-btn" onClick={reveal} title="Reveal original file">
              <FolderOpen size={15} />
            </button>
          )}
          <button className="doc-btn" onClick={openExternal} title="Open in default app">
            <ExternalLink size={15} />
          </button>
        </div>
      </div>

      <div className="doc-scroll scroll-y" ref={scrollRef}>
        {error ? (
          <div className="doc-empty">
            {error}
            <button className="doc-fallback" onClick={openExternal}>Open in default app</button>
          </div>
        ) : loading ? (
          <div className="doc-empty">Loading…</div>
        ) : kind === 'pdf' && bytes.data ? (
          <PdfView
            bytes={bytes.data.bytes}
            scale={scale}
            scrollRef={scrollRef}
            onCount={onCount}
            onPage={onPage}
            registerGoto={registerGoto}
            onRendered={onRendered}
            onError={setRenderErr}
          />
        ) : kind === 'image' && bytes.url ? (
          <ImageView url={bytes.url} scale={scale} />
        ) : kind === 'docx' && bytes.data ? (
          <DocxView bytes={bytes.data.bytes} onRendered={onRendered} onError={setRenderErr} />
        ) : kind === 'sheet' && model?.kind === 'sheet' ? (
          <SheetView sheets={model.sheets} truncated={model.truncated} />
        ) : kind === 'slides' && model?.kind === 'slides' ? (
          <SlideView slides={model.slides} scrollRef={scrollRef} onCount={onCount} onPage={onPage} registerGoto={registerGoto} />
        ) : kind === 'markdown' ? (
          <MarkdownView body={item.body ?? ''} />
        ) : kind === 'code' ? (
          <CodeView body={item.body ?? ''} lang={(item.meta?.fileType || '').toLowerCase()} />
        ) : kind === 'csv' ? (
          <CsvView body={item.body ?? ''} delim={(item.meta?.fileType || '').toLowerCase() === 'tsv' ? '\t' : ','} />
        ) : (
          <TextView body={item.body ?? ''} />
        )}
      </div>

      <Modal
        open={pptxWarn}
        onClose={() => setPptxWarn(false)}
        title="Experimental slide preview"
        actions={
          <>
            <Button
              variant="secondary"
              small
              onClick={() => {
                localStorage.setItem('luna.pptxWarnHidden', '1')
                setPptxWarn(false)
              }}
            >
              Don't show again
            </Button>
            <Button variant="primary" small onClick={() => setPptxWarn(false)}>
              Got it
            </Button>
          </>
        }
      >
        <p>
          PowerPoint rendering is experimental. Text and images are placed by their real position, but gradients,
          SmartArt, charts, and animations aren't drawn — so a complex deck may look different from PowerPoint. Use
          <strong> Open in default app</strong> for a perfect copy.
        </p>
      </Modal>
    </div>
  )
}
