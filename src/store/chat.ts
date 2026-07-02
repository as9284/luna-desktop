import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useSettings } from './settings'

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
  /** threadId → in-flight request id; a thread streams independently of the others */
  streamingByThread: Record<string, string>
  /** threadId → transient status line ("Searching the web…") */
  statusByThread: Record<string, string | null>
  /** threadId → last error for that thread */
  errorByThread: Record<string, string>
  /** threads that finished streaming while not active */
  unreadIds: Record<string, true>
  send: (text: string, opts: { temperature: number; system: string }) => Promise<void>
  stop: (threadId: string) => void
  newThread: () => void
  selectThread: (id: string) => void
  deleteThread: (id: string) => void
}

const uid = () => crypto.randomUUID()
const newThreadObj = (): Thread => ({ id: crypto.randomUUID(), title: 'New conversation', messages: [], updatedAt: Date.now() })

const omit = <T>(rec: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _drop, ...rest } = rec
  return rest
}

export const useChat = create<ChatState>()(
  persist(
    (set, get) => {
      const initial = newThreadObj()
      return {
        threads: [initial],
        activeId: initial.id,
        streamingByThread: {},
        statusByThread: {},
        errorByThread: {},
        unreadIds: {},

        newThread: () => {
          const t = newThreadObj()
          set((s) => ({ threads: [t, ...s.threads], activeId: t.id }))
        },

        selectThread: (id) =>
          set((s) => ({ activeId: id, unreadIds: omit(s.unreadIds, id) })),

        deleteThread: (id) => {
          // cancel an in-flight response so it doesn't stream into the void
          const reqId = get().streamingByThread[id]
          if (reqId) window.api?.cancelChat?.(reqId)
          set((s) => {
            const cleaned = {
              streamingByThread: omit(s.streamingByThread, id),
              statusByThread: omit(s.statusByThread, id),
              errorByThread: omit(s.errorByThread, id),
              unreadIds: omit(s.unreadIds, id),
            }
            const threads = s.threads.filter((t) => t.id !== id)
            if (threads.length === 0) {
              const t = newThreadObj()
              return { threads: [t], activeId: t.id, ...cleaned }
            }
            if (s.activeId !== id) return { threads, ...cleaned }
            const next = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)[0]
            return { threads, activeId: next.id, ...cleaned }
          })
        },

        stop: (threadId) => {
          const reqId = get().streamingByThread[threadId]
          if (reqId) window.api?.cancelChat?.(reqId)
        },

        send: async (text, opts) => {
          const api = typeof window !== 'undefined' ? window.api : undefined
          const targetId = get().activeId
          if (!api?.chat) {
            set((s) => ({
              errorByThread: { ...s.errorByThread, [targetId]: 'Desktop bridge unavailable — run the app with the Electron shell.' },
            }))
            return
          }
          if (get().streamingByThread[targetId]) return // one response per thread at a time

          const requestId = crypto.randomUUID()
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
            streamingByThread: { ...s.streamingByThread, [targetId]: requestId },
            statusByThread: { ...s.statusByThread, [targetId]: null },
            errorByThread: omit(s.errorByThread, targetId),
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
              statusByThread: { ...s.statusByThread, [targetId]: null },
            }))

          try {
            const research = useSettings.getState().researchShelf
            await api.chat({ id: requestId, messages: payload, temperature: opts.temperature, research }, appendToken, (status) =>
              set((s) => ({ statusByThread: { ...s.statusByThread, [targetId]: status } })),
            )
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            set((s) => ({
              threads: s.threads.map((t) =>
                t.id === targetId ? { ...t, messages: t.messages.filter((m) => !(m.id === botId && !m.content)) } : t,
              ),
              errorByThread: { ...s.errorByThread, [targetId]: msg },
            }))
          } finally {
            set((s) => {
              const stillExists = s.threads.some((t) => t.id === targetId)
              const finishedInBackground = stillExists && s.activeId !== targetId
              return {
                // drop the assistant placeholder if the stream ended with no content (e.g. stopped early)
                threads: s.threads.map((t) =>
                  t.id === targetId ? { ...t, messages: t.messages.filter((m) => !(m.id === botId && !m.content)) } : t,
                ),
                streamingByThread: omit(s.streamingByThread, targetId),
                statusByThread: omit(s.statusByThread, targetId),
                unreadIds: finishedInBackground ? { ...s.unreadIds, [targetId]: true } : s.unreadIds,
              }
            })
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
