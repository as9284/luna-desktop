import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import type { MenuAction } from './Select'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

/** A right-click menu row — same shape as the dropdown `Menu`, plus an optional disabled state. */
export type ContextItem = (MenuAction & { disabled?: boolean }) | 'sep'

interface ContextMenuState {
  open: boolean
  x: number
  y: number
  items: ContextItem[]
  show: (x: number, y: number, items: ContextItem[]) => void
  close: () => void
}

const useContextMenu = create<ContextMenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (x, y, items) => set({ open: true, x, y, items }),
  close: () => set({ open: false, items: [] }),
}))

/**
 * Open the shared right-click menu at the cursor. Wire to any element:
 *   onContextMenu={(e) => openContextMenu(e, [{ label: 'Delete', danger: true, onSelect: … }])}
 * With no items it does nothing, letting the native menu through.
 */
export function openContextMenu(e: ReactMouseEvent, items: ContextItem[]) {
  if (items.length === 0) return
  e.preventDefault()
  e.stopPropagation()
  useContextMenu.getState().show(e.clientX, e.clientY, items)
}

/** Mounted once at the app root; renders whichever menu is currently open, at the cursor. */
export function ContextMenuHost() {
  const { open, x, y, items, close } = useContextMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // clamp inside the viewport once the menu has a measured size
  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el) return
    const pad = 8
    setPos({
      x: Math.max(pad, Math.min(x, window.innerWidth - el.offsetWidth - pad)),
      y: Math.max(pad, Math.min(y, window.innerHeight - el.offsetHeight - pad)),
    })
  }, [open, x, y])

  // dismiss on outside press, Escape, scroll, resize, or losing focus
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, close])

  if (!open) return null

  return createPortal(
    <div
      ref={ref}
      className="menu ctx-menu"
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className={cx('menu-item', it.danger && 'menu-item--danger')}
            disabled={it.disabled}
            onClick={() => {
              close()
              it.onSelect()
            }}
          >
            {it.icon}
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
