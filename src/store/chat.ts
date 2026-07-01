import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
}
export interface Thread {
  id: string
  title: string
  messages: Msg[]
  updatedAt: number
}

interface ChatState {
  threads: Thread[]
  activeId: string
  streaming: boolean
  status: string | null
  error: string | null
  send: (text: string, opts: { temperature: number; system: string }) => Promise<void>
  newThread: () => void
  selectThread: (id: string) => void
  deleteThread: (id: string) => void
}

let _id = 0
const uid = () => `m${++_id}`
const newThreadObj = (): Thread => ({ id: crypto.randomUUID(), title: 'New conversation', messages: [], updatedAt: Date.now() })

export const useChat = create<ChatState>()(
  persist(
    (set, get) => {
      const initial = newThreadObj()
      return {
        threads: [initial],
        activeId: initial.id,
        streaming: false,
        status: null,
        error: null,

        newThread: () => {
          const t = newThreadObj()
          set((s) => ({ threads: [t, ...s.threads], activeId: t.id, error: null }))
        },

        selectThread: (id) => set({ activeId: id, error: null }),

        deleteThread: (id) =>
          set((s) => {
            const threads = s.threads.filter((t) => t.id !== id)
            if (threads.length === 0) {
              const t = newThreadObj()
              return { threads: [t], activeId: t.id }
            }
            if (s.activeId !== id) return { threads }
            const next = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)[0]
            return { threads, activeId: next.id }
          }),

        send: async (text, opts) => {
          const api = typeof window !== 'undefined' ? window.api : undefined
          if (!api?.chat) {
            set({ error: 'Desktop bridge unavailable — run the app with the Electron shell.' })
            return
          }

          const targetId = get().activeId
          const userMsg: Msg = { id: uid(), role: 'user', content: text }
          const botId = uid()

          set((s) => ({
            threads: s.threads.map((t) =>
              t.id === targetId
                ? {
                    ...t,
                    title: t.messages.length === 0 ? text.slice(0, 40) + (text.length > 40 ? '…' : '') : t.title,
                    messages: [...t.messages, userMsg, { id: botId, role: 'assistant', content: '' }],
                    updatedAt: Date.now(),
                  }
                : t,
            ),
            streaming: true,
            status: null,
            error: null,
          }))

          const thread = get().threads.find((t) => t.id === targetId)
          const history = (thread?.messages ?? [])
            .filter((m) => m.id !== botId)
            .map((m) => ({ role: m.role, content: m.content }))
          const payload = [{ role: 'system', content: opts.system }, ...history]

          const appendToken = (token: string) =>
            set((s) => ({
              threads: s.threads.map((t) =>
                t.id === targetId
                  ? { ...t, messages: t.messages.map((m) => (m.id === botId ? { ...m, content: m.content + token } : m)) }
                  : t,
              ),
              status: null,
            }))

          try {
            await api.chat({ messages: payload, temperature: opts.temperature }, appendToken, (status) => set({ status }))
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            set((s) => ({
              threads: s.threads.map((t) =>
                t.id === targetId ? { ...t, messages: t.messages.filter((m) => !(m.id === botId && !m.content)) } : t,
              ),
              error: msg,
            }))
          } finally {
            set({ streaming: false, status: null })
          }
        },
      }
    },
    {
      name: 'luna-chat',
      partialize: (s) => ({ threads: s.threads, activeId: s.activeId }),
    },
  ),
)
