import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Mode = 'concise' | 'balanced' | 'creative'

interface SettingsState {
  // The DeepSeek API key lives in Electron safeStorage (via window.api), not here.
  mode: Mode
  reducedMotion: boolean
  /** archive pages Luna reads during web search to the Atlas research shelf */
  researchShelf: boolean
  set: (partial: Partial<SettingsState>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      mode: 'balanced',
      reducedMotion: false,
      researchShelf: false,
      set: (partial) => set(partial),
    }),
    {
      name: 'luna-settings',
      // never persist the API key to localStorage — only non-secret prefs
      partialize: (s) => ({ mode: s.mode, reducedMotion: s.reducedMotion, researchShelf: s.researchShelf }),
    },
  ),
)
