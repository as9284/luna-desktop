import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

/* ---------------- buttons ---------------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
export function Button({
  variant = 'secondary',
  small,
  className,
  children,
  ...props
}: { variant?: Variant; small?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cx('btn', `btn--${variant}`, small && 'btn--sm', className)} {...props}>
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cx('icon-btn', className)} aria-label={label} {...props}>
      {children}
    </button>
  )
}

/* ---------------- fields ---------------- */
export function Field({
  label,
  help,
  error,
  className,
  children,
}: {
  label?: string
  help?: ReactNode
  error?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx('field', error && 'err', className)}>
      {label && <span className="lbl">{label}</span>}
      {children}
      {help && (
        <span className="help">
          {error && (
            <svg viewBox="0 0 14 14">
              <circle cx="7" cy="7" r="5.5" />
              <path d="M7 4v3.5M7 9.4v.1" />
            </svg>
          )}
          {help}
        </span>
      )}
    </div>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('input', className)} {...props} />
}

/* ---------------- selection ---------------- */
export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
}) {
  return (
    <label className="opt">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="box">
        <svg viewBox="0 0 14 14">
          <path d="M2.5 7.5l3 3 6-7" />
        </svg>
      </span>
      {label}
    </label>
  )
}

export function Radio({
  checked,
  onChange,
  name,
  label,
}: {
  checked: boolean
  onChange: () => void
  name: string
  label: ReactNode
}) {
  return (
    <label className="opt radio">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className="box" />
      {label}
    </label>
  )
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
}) {
  if (!label) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={cx('switch', checked && 'on')}
        onClick={() => onChange(!checked)}
      />
    )
  }
  // labelled: only the label handles the click, so the toggle fires exactly once
  return (
    <label className="switch-row" onClick={() => onChange(!checked)}>
      <span className={cx('switch', checked && 'on')} role="switch" aria-checked={checked} />
      {label}
    </label>
  )
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ background: `linear-gradient(90deg,#fff ${pct}%,rgba(255,255,255,.14) ${pct}%)` }}
    />
  )
}

/* ---------------- nav ---------------- */
export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={cx('tab', value === t.id && 'active')} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.id} className={cx(value === o.id && 'active')} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------- display ---------------- */
export function Badge({
  variant = 'subtle',
  children,
}: {
  variant?: 'solid' | 'subtle' | 'outline'
  children: ReactNode
}) {
  return <span className={cx('badge', `badge--${variant}`)}>{children}</span>
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('card', className)}>{children}</div>
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="tip">
      {children}
      <span className="tip-body">{label}</span>
    </span>
  )
}
