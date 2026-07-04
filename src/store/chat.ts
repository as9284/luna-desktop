import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useSettings } from './settings'

export interface Attachment {
  name: string
  kind?: string
  /** extracted text — sent to the model, not persisted in the visible bubble */
  text?: string
  /** downscaled JPEG data-URL for image attachments (shown as a thumbnail, persisted) */
  preview?: string
}
export interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** files the user attached to this turn — chips, or a thumbnail when there's an image preview */
  attachments?: { name: string; kind?: string; preview?: string }[]
  /** inline Orbit/Atlas preview cards Luna produced during this turn */
  cards?: LunaChatCard[]
  /** the activity trace — every step Luna ran this turn, saved for the compact record */
  trace?: LunaStep[]
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
  /** threadId → the live activity trace while a turn is in flight (accumulates, then saved to the message) */
  stepsByThread: Record<string, LunaStep[]>
  /** threadId → last error for that thread */
  errorByThread: Record<string, string>
  /** threads that finished streaming while not active */
  unreadIds: Record<string, true>
  send: (text: string, opts: { temperature: number }, attachments?: Attachment[]) => Promise<void>
  /** Cancel any in-flight reply and drop the last user turn + its response, returning the
   *  retracted user text so the composer can restore it for editing (null if nothing to retract). */
  retractLast: (threadId: string) => string | null
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
        stepsByThread: {},
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
              stepsByThread: omit(s.stepsByThread, id),
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

        retractLast: (threadId) => {
          const reqId = get().streamingByThread[threadId]
          if (reqId) window.api?.cancelChat?.(reqId) // stop an in-flight stream first
          let restored: string | null = null
          set((s) => ({
            threads: s.threads.map((t) => {
              if (t.id !== threadId) return t
              // find the last user message and drop it + everything after (its reply/placeholder)
              let idx = -1
              for (let i = 0; i < t.messages.length; i++) if (t.messages[i].role === 'user') idx = i
              if (idx === -1) return t
              restored = t.messages[idx].content
              return { ...t, messages: t.messages.slice(0, idx), updatedAt: Date.now() }
            }),
            streamingByThread: omit(s.streamingByThread, threadId),
            stepsByThread: omit(s.stepsByThread, threadId),
            errorByThread: omit(s.errorByThread, threadId),
          }))
          return restored
        },

        send: async (text, opts, attachments) => {
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
          // keep an attachment if it carries model text OR a viewable image preview
          const atts = attachments?.filter((a) => a.text || a.preview) ?? []
          const userMsg: Msg = {
            id: uid(),
            role: 'user',
            content: text,
            ...(atts.length
              ? { attachments: atts.map((a) => ({ name: a.name, kind: a.kind, ...(a.preview ? { preview: a.preview } : {}) })) }
              : {}),
          }
          const botId = uid()

          set((s) => ({
            threads: s.threads.map((t) =>
              t.id === targetId
                ? {
                    ...t,
                    title:
                      t.messages.length === 0
                        ? text.trim()
                          ? text.slice(0, 40) + (text.length > 40 ? '…' : '')
                          : atts[0]?.name ?? 'New conversation'
                        : t.title,
                    messages: [...t.messages, userMsg, { id: botId, role: 'assistant', content: '' }],
                    updatedAt: Date.now(),
                  }
                : t,
            ),
            streamingByThread: { ...s.streamingByThread, [targetId]: requestId },
            stepsByThread: { ...s.stepsByThread, [targetId]: [] },
            errorByThread: omit(s.errorByThread, targetId),
          }))

          const thread = get().threads.find((t) => t.id === targetId)
          const history = (thread?.messages ?? [])
            .filter((m) => m.id !== botId)
            .map((m) => ({ role: m.role, content: m.content }))
          // fold the attached files' text into the model payload for THIS turn only (the stored
          // bubble stays lean — attachments show as chips/thumbnails, their full text isn't persisted)
          const withText = atts.filter((a) => a.text)
          if (withText.length && history.length) {
            const blocks = withText
              .map((a) => `--- FILE: ${a.name}${a.kind ? ` (${a.kind})` : ''} ---\n${a.text}`)
              .join('\n\n')
            const last = history[history.length - 1]
            last.content = `${last.content}\n\n[Attached files]\n${blocks}\n[End of attached files]`
          }
          // no system message here — the main process prepends Luna's composed identity
          // (soul + rules + skills + memory) because we pass identity: true below
          const payload = [...history]

          const appendToken = (token: string) =>
            set((s) => ({
              threads: s.threads.map((t) =>
                t.id === targetId
                  ? { ...t, messages: t.messages.map((m) => (m.id === botId ? { ...m, content: m.content + token } : m)) }
                  : t,
              ),
            }))

          // accumulate the live activity trace: a running step creates a row, later events with
          // the same id update it in place (sub-phase detail, then done/error)
          const upsertStep = (step: LunaStep) =>
            set((s) => {
              const cur = s.stepsByThread[targetId] ?? []
              const idx = cur.findIndex((x) => x.id === step.id)
              const next = idx === -1 ? [...cur, step] : cur.map((x, i) => (i === idx ? step : x))
              return { stepsByThread: { ...s.stepsByThread, [targetId]: next } }
            })

          const appendCard = (card: LunaChatCard) =>
            set((s) => ({
              threads: s.threads.map((t) =>
                t.id === targetId
                  ? { ...t, messages: t.messages.map((m) => (m.id === botId ? { ...m, cards: [...(m.cards ?? []), card] } : m)) }
                  : t,
              ),
            }))

          try {
            const research = useSettings.getState().researchShelf
            await api.chat(
              { id: requestId, messages: payload, temperature: opts.temperature, research, identity: true },
              appendToken,
              upsertStep,
              appendCard,
            )
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            set((s) => {
              // a stop/retract or a newer send already superseded this request — it's not a real error
              if (s.streamingByThread[targetId] !== requestId) return {}
              return {
                threads: s.threads.map((t) =>
                  t.id === targetId ? { ...t, messages: t.messages.filter((m) => !(m.id === botId && !m.content && !m.cards?.length)) } : t,
                ),
                errorByThread: { ...s.errorByThread, [targetId]: msg },
              }
            })
          } finally {
            set((s) => {
              // if a stop/retract cleared this thread or a newer send now owns it, leave its state alone
              if (s.streamingByThread[targetId] !== requestId) return {}
              const stillExists = s.threads.some((t) => t.id === targetId)
              const finishedInBackground = stillExists && s.activeId !== targetId
              // finalize any step still marked running (a stop mid-tool), then save the trace to the message
              const steps = (s.stepsByThread[targetId] ?? []).map((st) => (st.state === 'running' || st.state === 'awaiting' ? { ...st, state: 'done' as const } : st))
              return {
                threads: s.threads.map((t) =>
                  t.id === targetId
                    ? {
                        ...t,
                        messages: t.messages
                          .map((m) => (m.id === botId && steps.length ? { ...m, trace: steps } : m))
                          // drop the assistant placeholder only if it produced nothing at all
                          .filter((m) => !(m.id === botId && !m.content && !m.cards?.length && !steps.length)),
                      }
                    : t,
                ),
                streamingByThread: omit(s.streamingByThread, targetId),
                stepsByThread: omit(s.stepsByThread, targetId),
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
