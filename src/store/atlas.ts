import { create } from 'zustand'

/**
 * Thin renderer cache over the SQLite library in the main process. The main
 * process owns the data; this store just mirrors the current list/filters and
 * refreshes on `atlas:changed` pings (subscribed in App.tsx).
 */

export interface AtlasFilterState {
  query: string
  status: 'all' | 'queued' | AtlasStatus
  tag: string | null
  domain: string | null
}

interface AtlasState {
  items: AtlasItem[]
  facets: { tags: string[]; domains: string[] }
  filters: AtlasFilterState
  loaded: boolean
  /** id of the item open in the reader, null = library */
  readingId: string | null
  setFilters: (patch: Partial<AtlasFilterState>) => void
  openReader: (id: string | null) => void
  refresh: () => Promise<void>
}

const DEFAULT_FILTERS: AtlasFilterState = { query: '', status: 'all', tag: null, domain: null }

export const useAtlas = create<AtlasState>((set, get) => ({
  items: [],
  facets: { tags: [], domains: [] },
  filters: DEFAULT_FILTERS,
  loaded: false,
  readingId: null,

  setFilters: (patch) => {
    set((s) => ({ filters: { ...s.filters, ...patch } }))
    void get().refresh()
  },

  openReader: (id) => set({ readingId: id }),

  refresh: async () => {
    const api = window.api?.atlas
    if (!api) return
    const f = get().filters
    const [items, facets] = await Promise.all([
      api.list({
        query: f.query.trim() || undefined,
        status: f.status === 'all' ? undefined : f.status,
        tag: f.tag ?? undefined,
        domain: f.domain ?? undefined,
      }),
      api.facets(),
    ])
    set({ items, facets, loaded: true })
  },
}))
