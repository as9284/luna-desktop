import { useEffect, useRef, useState, type ReactNode } from 'react'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [open, close])
  return ref
}

export interface SelectOption {
  value: string
  label: string
}

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  const current = options.find((o) => o.value === value)
  return (
    <div className={cx('select', open && 'open', className)} ref={ref}>
      <div className="select-trigger" onClick={() => setOpen((o) => !o)}>
        <span>{current ? current.label : 'Select…'}</span>
        <svg viewBox="0 0 16 16">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </div>
      {open && (
        <div className="menu">
          {options.map((o) => (
            <button
              key={o.value}
              className={cx('menu-item', o.value === value && 'sel')}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              {o.label}
              <svg className="ck" viewBox="0 0 14 14">
                <path d="M2.5 7.5l3 3 6-7" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export interface MenuAction {
  label: string
  icon?: ReactNode
  danger?: boolean
  onSelect: () => void
}

export function Menu({ trigger, items }: { trigger: ReactNode; items: (MenuAction | 'sep')[] }) {
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  return (
    <div className="select" ref={ref} style={{ display: 'inline-block', width: 'auto' }}>
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open && (
        <div className="menu">
          {items.map((it, i) =>
            it === 'sep' ? (
              <div key={i} className="menu-sep" />
            ) : (
              <button
                key={i}
                className={cx('menu-item', it.danger && 'menu-item--danger')}
                onClick={() => {
                  it.onSelect()
                  setOpen(false)
                }}
              >
                {it.icon}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
