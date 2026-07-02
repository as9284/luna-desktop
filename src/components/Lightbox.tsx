import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { createPortal } from 'react-dom'

const MIN = 1
const MAX = 6
const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s))

/** Full-screen image viewer: scroll or +/- to zoom, click to toggle 2×, drag to pan, Esc to close. */
export default function Lightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const moved = useRef(false)

  const reset = () => {
    setScale(1)
    setPos({ x: 0, y: 0 })
  }
  const zoom = (delta: number) =>
    setScale((s) => {
      const next = clamp(s + delta)
      if (next === 1) setPos({ x: 0, y: 0 })
      return next
    })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') zoom(0.4)
      else if (e.key === '-' || e.key === '_') zoom(-0.4)
      else if (e.key === '0') reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // pan while zoomed — window-level so the drag survives leaving the image bounds
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return
      if (Math.abs(e.clientX - drag.current.x) + Math.abs(e.clientY - drag.current.y) > 3) moved.current = true
      setPos({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) })
    }
    const onUp = () => {
      drag.current = null
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onWheel = (e: ReactWheelEvent) => zoom(e.deltaY < 0 ? 0.4 : -0.4)
  const onDown = (e: ReactMouseEvent) => {
    if (scale === 1) return
    e.preventDefault()
    moved.current = false
    drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y }
    setDragging(true)
  }
  const onImgClick = (e: ReactMouseEvent) => {
    e.stopPropagation()
    if (moved.current) {
      moved.current = false
      return // a pan, not a click — keep the current zoom
    }
    if (scale === 1) setScale(2)
    else reset()
  }

  return createPortal(
    <div className="lightbox" onClick={onClose} onWheel={onWheel}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => zoom(-0.4)} disabled={scale <= MIN} aria-label="Zoom out">
          −
        </button>
        <span className="lightbox-pct">{Math.round(scale * 100)}%</span>
        <button onClick={() => zoom(0.4)} disabled={scale >= MAX} aria-label="Zoom in">
          +
        </button>
        <button onClick={reset} disabled={scale === 1 && pos.x === 0 && pos.y === 0} aria-label="Reset zoom">
          Reset
        </button>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <img
        className="lightbox-img"
        src={src}
        alt={alt}
        draggable={false}
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          cursor: dragging ? 'grabbing' : scale > 1 ? 'grab' : 'zoom-in',
          transition: dragging ? 'none' : 'transform 0.14s ease-out',
        }}
        onClick={onImgClick}
        onMouseDown={onDown}
      />

      {alt && (
        <div className="lightbox-cap" onClick={(e) => e.stopPropagation()}>
          {alt}
        </div>
      )}
    </div>,
    document.body,
  )
}
