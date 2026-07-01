import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface MeetingEntry {
  id: string
  content: string
  createdAt: number
}

/** What Luna produced from a meeting's notes and filed into Orbit (kept for history). */
export interface MeetingArtifacts {
  createdAt: number
  note: { title: string; content: string; noteId?: string }
  tasks: string[]
  project: { name: string } | null
  warning: string | null
}

export interface MeetingSession {
  id: string
  title: string
  startedAt: number
  endedAt: number | null
  entries: MeetingEntry[]
  artifacts?: MeetingArtifacts
}

interface MeetingsState {
  activeSession: MeetingSession | null
  sessions: MeetingSession[]
  startSession: (title: string) => MeetingSession | null
  addEntry: (content: string) => boolean
  discardActive: () => void
  endSession: (artifacts: MeetingArtifacts) => void
  deleteSession: (id: string) => void
}

const uid = () => crypto.randomUUID()

export const useMeetings = create<MeetingsState>()(
  persist(
    (set, get) => ({
      activeSession: null,
      sessions: [],

      startSession: (title) => {
        const t = title.trim()
        if (!t || get().activeSession) return null
        const session: MeetingSession = { id: uid(), title: t, startedAt: Date.now(), endedAt: null, entries: [] }
        set({ activeSession: session })
        return session
      },

      addEntry: (content) => {
        const c = content.trim()
        const active = get().activeSession
        if (!c || !active) return false
        set({ activeSession: { ...active, entries: [...active.entries, { id: uid(), content: c, createdAt: Date.now() }] } })
        return true
      },

      discardActive: () => set({ activeSession: null }),

      endSession: (artifacts) => {
        const active = get().activeSession
        if (!active) return
        const completed: MeetingSession = { ...active, endedAt: Date.now(), artifacts }
        set((s) => ({ activeSession: null, sessions: [completed, ...s.sessions] }))
      },

      deleteSession: (id) =>
        set((s) => ({
          sessions: s.sessions.filter((x) => x.id !== id),
          activeSession: s.activeSession?.id === id ? null : s.activeSession,
        })),
    }),
    { name: 'luna-meetings' },
  ),
)
