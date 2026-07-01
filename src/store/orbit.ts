import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Task {
  id: string
  text: string
  done: boolean
}
export interface Note {
  id: string
  title: string
  body: string
  ts: number
}
export type ProjectStatus = 'active' | 'paused' | 'done'
export interface Project {
  id: string
  name: string
  progress: number
  status: ProjectStatus
}

interface OrbitState {
  tasks: Task[]
  notes: Note[]
  projects: Project[]
  addTask: (text: string) => void
  toggleTask: (id: string) => void
  removeTask: (id: string) => void
  clearDone: () => void
  addNote: () => string
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'body'>>) => void
  removeNote: (id: string) => void
  addProject: (name: string) => void
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'progress' | 'status'>>) => void
  removeProject: (id: string) => void
}

const uid = () => crypto.randomUUID()

export const useOrbit = create<OrbitState>()(
  persist(
    (set) => ({
      tasks: [],
      notes: [],
      projects: [],

      addTask: (text) => set((s) => ({ tasks: [...s.tasks, { id: uid(), text, done: false }] })),
      toggleTask: (id) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      clearDone: () => set((s) => ({ tasks: s.tasks.filter((t) => !t.done) })),

      addNote: () => {
        const id = uid()
        set((s) => ({ notes: [{ id, title: '', body: '', ts: Date.now() }, ...s.notes] }))
        return id
      },
      updateNote: (id, patch) =>
        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, ts: Date.now() } : n)) })),
      removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),

      addProject: (name) =>
        set((s) => ({ projects: [...s.projects, { id: uid(), name, progress: 0, status: 'active' }] })),
      updateProject: (id, patch) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removeProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
    }),
    { name: 'luna-orbit' },
  ),
)
