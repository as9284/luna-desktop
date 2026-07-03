import { memo, useEffect, useRef, type RefObject } from 'react'

interface Props {
  slides: DocSlide[]
  scrollRef: RefObject<HTMLDivElement | null>
  onCount: (n: number) => void
  onPage: (n: number) => void
  registerGoto: (fn: (n: number) => void) => void
}

const pos = (sh: DocSlideShape, s: DocSlide) => ({
  left: `${(sh.x / s.w) * 100}%`,
  top: `${(sh.y / s.h) * 100}%`,
  width: `${(sh.w / s.w) * 100}%`,
  height: `${(sh.h / s.h) * 100}%`,
})
const runStyle = (r: DocSlideRun, s: DocSlide) => ({
  // cqw = 1% of the slide-canvas width, so text scales with the rendered slide
  fontSize: r.size ? `${(r.size / s.w) * 100}cqw` : '3.2cqw',
  fontWeight: r.bold ? 700 : undefined,
  fontStyle: r.italic ? 'italic' : undefined,
  color: r.color,
})

/**
 * Best-effort .pptx renderer: each slide is drawn to scale with its text boxes and images
 * positioned by their real coordinates. Not a full PowerPoint engine (no gradients, SmartArt,
 * charts or animations) — those decks still read as text and can be opened externally.
 */
const SlideView = memo(function SlideView({ slides, scrollRef, onCount, onPage, registerGoto }: Props) {
  const refs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    onCount(slides.length)
  }, [slides, onCount])

  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const mid = root.scrollTop + root.clientHeight / 3
        let cur = 1
        refs.current.forEach((el, i) => {
          if (el && el.offsetTop <= mid) cur = i + 1
        })
        onPage(cur)
      })
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    registerGoto((n) => {
      const el = refs.current[Math.max(1, Math.min(n, slides.length)) - 1]
      if (el && root) root.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' })
    })
    return () => root.removeEventListener('scroll', onScroll)
  }, [slides, scrollRef, onPage, registerGoto])

  if (!slides.length) return <div className="doc-empty">No slides could be rendered. Try opening it externally.</div>

  return (
    <div className="slides-host">
      {slides.map((s, i) => (
        <div
          key={i}
          className="slide-wrap"
          ref={(el) => {
            refs.current[i] = el
          }}
        >
          <div className="slide-num">
            {i + 1} / {slides.length}
          </div>
          <div className="slide" style={{ aspectRatio: `${s.w} / ${s.h}` }}>
            <div className="slide-canvas">
              {s.shapes.map((sh, j) =>
                sh.type === 'image' ? (
                  <img key={j} className="slide-img" src={sh.src} alt="" style={pos(sh, s)} />
                ) : (
                  <div key={j} className="slide-tb" style={pos(sh, s)}>
                    {sh.paras.map((p, k) => (
                      <p key={k} style={{ textAlign: p.align, margin: 0 }}>
                        {p.runs.map((r, l) => (
                          <span key={l} style={runStyle(r, s)}>
                            {r.text}
                          </span>
                        ))}
                      </p>
                    ))}
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
})

export default SlideView
