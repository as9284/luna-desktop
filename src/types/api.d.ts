export {}

interface ChatMessage {
  role: string
  content: string
}

interface MeetingArtifacts {
  note: { title: string; content: string }
  tasks: string[]
  project: { name: string } | null
  warning: string | null
}

declare global {
type AtlasStatus = 'unread' | 'reading' | 'done'

interface AtlasItem {
  id: string
  kind: 'url' | 'text'
  url: string | null
  domain: string | null
  title: string
  excerpt: string | null
  summary: string | null
  keyPoints: string[]
  quotes: string[]
  tags: string[]
  status: AtlasStatus
  queuedAt: number | null
  shelf: 'research' | null
  wordCount: number
  savedAt: number
  scroll: number
  body?: string
  content?: string
}

interface AtlasHighlight {
  id: string
  itemId: string
  text: string
  note: string
  createdAt: number
  itemTitle?: string
}

interface AtlasSaveResult {
  ok: boolean
  item?: AtlasItem
  existed?: boolean
  error?: string
}

interface AtlasExportResult {
  ok: boolean
  canceled?: boolean
  path?: string
  count?: number
  error?: string
}

interface AtlasApi {
  saveUrl: (url: string) => Promise<AtlasSaveResult>
  saveText: (title: string, text: string) => Promise<AtlasSaveResult>
  digest: (id: string) => Promise<{ item: AtlasItem; warning: string | null }>
  list: (filters?: { query?: string; status?: AtlasStatus | 'queued'; tag?: string; domain?: string }) => Promise<AtlasItem[]>
  get: (id: string) => Promise<{ item: AtlasItem; highlights: AtlasHighlight[] } | null>
  update: (
    id: string,
    patch: { title?: string; status?: AtlasStatus; queuedAt?: number | null; scroll?: number; tags?: string[] },
  ) => Promise<AtlasItem | null>
  remove: (id: string) => Promise<boolean>
  addHighlight: (itemId: string, text: string, note?: string) => Promise<AtlasHighlight | null>
  noteHighlight: (id: string, note: string) => Promise<boolean>
  removeHighlight: (id: string) => Promise<boolean>
  highlights: (query?: string) => Promise<AtlasHighlight[]>
  related: (id: string) => Promise<AtlasItem[]>
  facets: () => Promise<{ tags: string[]; domains: string[] }>
  exportItems: (ids: string[]) => Promise<AtlasExportResult>
  onChanged: (cb: () => void) => () => void
}
}

type UpdateEvent =
  | { type: 'checking' }
  | { type: 'none' }
  | { type: 'available'; payload: { version: string } }
  | { type: 'downloaded'; payload: { version: string } }
  | { type: 'progress'; payload: number }
  | { type: 'error'; payload: string }

interface UpdatesApi {
  version: () => Promise<string>
  check: () => Promise<{ ok: boolean; reason?: string }>
  download: () => Promise<{ ok: boolean; reason?: string }>
  install: () => void
  onEvent: (cb: (evt: UpdateEvent) => void) => () => void
}

declare global {
  interface LunaApi {
    minimize: () => void
    maximize: () => void
    close: () => void
    onMaximized: (cb: (isMax: boolean) => void) => () => void
    saveKey: (provider: string, key: string) => Promise<boolean>
    hasKey: (provider: string) => Promise<boolean>
    clearKey: (provider: string) => Promise<boolean>
    chat: (
      req: { id?: string; messages: ChatMessage[]; temperature?: number; tools?: boolean; research?: boolean },
      onChunk: (token: string) => void,
      onStatus?: (status: string | null) => void,
    ) => Promise<void>
    cancelChat: (id: string) => void
    onOrbitCall: (handler: (name: string, args: string) => string) => () => void
    summarizeMeeting: (title: string, notes: string[]) => Promise<MeetingArtifacts>
    atlas: AtlasApi
    updates: UpdatesApi
  }
  interface Window {
    api?: LunaApi
  }
}
