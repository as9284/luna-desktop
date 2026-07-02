import { useEffect, type ReactNode } from 'react'
import { Button } from './primitives'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
  wide,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children?: ReactNode
  actions?: ReactNode
  /** widen for content that needs room (pasting links, reading a synthesis) */
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  return (
    <div
      className={cx('scrim', open && 'open')}
      // kept in the DOM for the fade transition; inert removes it from focus order and
      // the accessibility tree while closed
      inert={!open}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={cx('modal', wide && 'modal--wide')} role="dialog" aria-modal="true">
        {title && <h3>{title}</h3>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

/** A reusable "are you sure?" dialog — title + message + Cancel/Delete. */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      actions={
        <>
          <Button variant="secondary" small onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" small onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  )
}
