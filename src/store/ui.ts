import { create } from 'zustand'

export type View = 'home' | 'luna' | 'module' | 'settings'

interface UIState {
  view: View
  module: string | null
  busy: boolean
  set: (partial: Partial<UIState>) => void
}

export const useUI = create<UIState>((set) => ({
  view: 'home',
  module: null,
  busy: false,
  set: (partial) => set(partial),
}))
