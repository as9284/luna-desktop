import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Accent = 'lunar' | 'violet' | 'teal' | 'amber' | 'rose' | 'sage'
export type UiScale = 'compact' | 'default' | 'large'
export type ReadFont = 'sans' | 'serif'
export type ReadSize = 'small' | 'default' | 'large'
export type Ambient = 'full' | 'subtle' | 'off'

interface SettingsState {
  // The API key lives in Electron safeStorage (via window.api), not here.
  reducedMotion: boolean
  /** archive pages Luna reads during web search to the Atlas research shelf */
  researchShelf: boolean
  // ---- appearance ----
  accent: Accent
  uiScale: UiScale
  readFont: ReadFont
  readSize: ReadSize
  ambient: Ambient
  set: (partial: Partial<SettingsState>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      reducedMotion: false,
      researchShelf: false,
      accent: 'lunar',
      uiScale: 'default',
      readFont: 'sans',
      readSize: 'default',
      ambient: 'full',
      set: (partial) => set(partial),
    }),
    {
      name: 'luna-settings',
      // never persist the API key to localStorage — only non-secret prefs
      partialize: (s) => ({
        reducedMotion: s.reducedMotion,
        researchShelf: s.researchShelf,
        accent: s.accent,
        uiScale: s.uiScale,
        readFont: s.readFont,
        readSize: s.readSize,
        ambient: s.ambient,
      }),
    },
  ),
)
