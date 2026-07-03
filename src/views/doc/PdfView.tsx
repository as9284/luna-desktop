import { useEffect, useRef, type RefObject } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

const MAX_PAGES = 500

interface Props {
  bytes: Uint8Array
  scale: number
  scrollRef: RefObject<HTMLDivElement | null>
  onCount: (n: number) => void
  onPage: (n: number) => void
  registerGoto: (fn: (n: number) => void) => void
  onRendered: () => void // find re-runs when new pages paint
  onError: (msg: string) => void
}

/**
 * Renders a PDF page-by-page onto canvases (crisp at devicePixelRatio) with a pdf.js text layer
 * over each page so text is selectable and findable. Pages render lazily as they scroll near the
 * viewport, so a 300-page report doesn't rasterize all at once.
 */
export default function PdfView({ bytes, scale, scrollRef, onCount, onPage, registerGoto, onRendered, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docRef = useRef<any>(null)
  const holders = useRef<HTMLDivElement[]>([])
  const done = useRef<Map<number, number>>(new Map()) // page → scale it was rendered at
  const inflight = useRef<Set<number>>(new Set()) // pages mid-render (never render one page twice at once)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = useRef<Map<number, any>>(new Map()) // active pdf.js RenderTasks — cancelled on teardown
  const base = useRef<{ w: number; h: number }>({ w: 612, h: 792 })
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // ---- load document ----
  useEffect(() => {
    let cancelled = false
    holders.current = []
    done.current.clear()
    inflight.current.clear() // a new document — don't let a stale in-flight page block its twin
    tasks.current.clear()
    const task = pdfjs.getDocument({ data: bytes.slice() }) // slice: pdf.js detaches the buffer
    task.promise
      .then(async (doc) => {
        if (cancelled) return doc.destroy()
        docRef.current = doc
        const count = Math.min(doc.numPages, MAX_PAGES)
        onCount(count)
        const first = await doc.getPage(1)
        const vp = first.getViewport({ scale: 1 })
        base.current = { w: vp.width, h: vp.height }
        buildPlaceholders(count)
      })
      .catch((e) => !cancelled && onError(e instanceof Error ? e.message : 'Could not open the PDF.'))
    return () => {
      cancelled = true
      for (const t of tasks.current.values()) {
        try {
          t.cancel()
        } catch {
          /* already settled */
        }
      }
      tasks.current.clear()
      docRef.current?.destroy()
      docRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes])

  function buildPlaceholders(count: number) {
    const host = hostRef.current
    if (!host) return
    host.replaceChildren()
    holders.current = []
    for (let i = 1; i <= count; i++) {
      const holder = document.createElement('div')
      holder.className = 'pdf-page'
      holder.dataset.page = String(i)
      host.appendChild(holder)
      holders.current.push(holder)
    }
    sizePlaceholders()
    observe()
    // render the first couple of pages immediately
    void renderPage(1)
    if (count > 1) void renderPage(2)
  }

  function sizePlaceholders() {
    const s = scaleRef.current
    for (const h of holders.current) {
      if (done.current.get(Number(h.dataset.page)) === s) continue
      h.style.width = `${Math.floor(base.current.w * s)}px`
      h.style.height = `${Math.floor(base.current.h * s)}px`
    }
  }

  const io = useRef<IntersectionObserver | null>(null)
  function observe() {
    io.current?.disconnect()
    io.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) void renderPage(Number((e.target as HTMLElement).dataset.page))
      },
      { root: scrollRef.current, rootMargin: '800px 0px' },
    )
    for (const h of holders.current) io.current.observe(h)
  }

  async function renderPage(n: number) {
    const doc = docRef.current
    const holder = holders.current[n - 1]
    const s = scaleRef.current
    // never run two renders for the same page at once — concurrent renders to one canvas
    // corrupt it (the "upside-down until you zoom" bug). Skip if already current or in flight.
    if (!doc || !holder || done.current.get(n) === s || inflight.current.has(n)) return
    inflight.current.add(n)
    let painted = false
    try {
      const page = await doc.getPage(n)
      const dpr = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: s })
      let canvas = holder.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) {
        canvas = document.createElement('canvas')
        holder.appendChild(canvas)
      }
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      holder.style.width = `${Math.floor(viewport.width)}px`
      holder.style.height = `${Math.floor(viewport.height)}px`
      const ctx = canvas.getContext('2d')!
      const task = page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      tasks.current.set(n, task)
      await task.promise

      // selectable + findable text layer over the canvas
      try {
        let layer = holder.querySelector('.textLayer') as HTMLDivElement | null
        if (!layer) {
          layer = document.createElement('div')
          layer.className = 'textLayer'
          holder.appendChild(layer)
        }
        layer.replaceChildren()
        layer.style.setProperty('--scale-factor', String(s))
        holder.style.setProperty('--scale-factor', String(s))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const TextLayer = (pdfjs as any).TextLayer
        if (TextLayer) {
          const tl = new TextLayer({ textContentSource: await page.getTextContent(), container: layer, viewport })
          await tl.render()
        }
      } catch {
        /* text layer is best-effort; the page image is what matters */
      }
      done.current.set(n, s)
      painted = true
      onRendered()
    } catch {
      /* skip a page we can't render (includes a cancelled RenderTask on teardown) */
    } finally {
      inflight.current.delete(n)
      tasks.current.delete(n)
    }
    // if the user zoomed while this page was rendering, it's now stale — repaint at the new scale
    if (painted && holder.isConnected && done.current.get(n) !== scaleRef.current) void renderPage(n)
  }

  // ---- re-render on zoom ----
  useEffect(() => {
    if (!holders.current.length) return
    done.current.clear()
    sizePlaceholders()
    // re-render pages currently in view
    const root = scrollRef.current
    if (!root) return
    const top = root.scrollTop
    const bottom = top + root.clientHeight
    for (const h of holders.current) {
      if (h.offsetTop < bottom + 800 && h.offsetTop + h.offsetHeight > top - 800) void renderPage(Number(h.dataset.page))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])

  // ---- current page tracking + goto ----
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const mid = root.scrollTop + root.clientHeight / 3
        let current = 1
        for (const h of holders.current) {
          if (h.offsetTop <= mid) current = Number(h.dataset.page)
          else break
        }
        onPage(current)
      })
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    registerGoto((n: number) => {
      const h = holders.current[Math.max(1, Math.min(n, holders.current.length)) - 1]
      if (h && root) root.scrollTo({ top: h.offsetTop - 12, behavior: 'smooth' })
    })
    return () => root.removeEventListener('scroll', onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className="pdf-host" />
}
