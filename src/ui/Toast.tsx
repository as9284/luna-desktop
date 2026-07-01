import { useEffect, useState } from 'react'
import { create } from 'zustand'

interface ToastItem {
  id: number
  msg: string
}
interface ToastState {
  toasts: ToastItem[]
  push: (msg: string) => void
  remove: (id: number) => void
}

let _id = 0
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (msg) => {
    const id = ++_id
    set((s) => ({ toasts: [...s.toasts, { id, msg }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2600)
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = (msg: string) => useToasts.getState().push(msg)

function Item({ msg }: { msg: string }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setShow(true))
    return () => cancelAnimationFrame(r)
  }, [])
  return (
    <div className={'toast' + (show ? ' show' : '')}>
      <span className="pip" />
      {msg}
    </div>
  )
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <Item key={t.id} msg={t.msg} />
      ))}
    </div>
  )
}
