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
type AtlasMediaType = 'article' | 'social' | 'video' | 'image' | 'pdf' | 'stub' | 'file'

interface AtlasQuotedPost {
  author?: string
  handle?: string
  text?: string
  media?: string[]
}

interface AtlasMeta {
  author?: string
  handle?: string
  avatar?: string
  siteName?: string
  publishedAt?: string
  media?: string[]
  hero?: string
  duration?: string
  pages?: number
  sourcePath?: string
  fileType?: string
  vaultFile?: string
  quoted?: AtlasQuotedPost
  stats?: { label: string; value: string }[]
}

interface AtlasItem {
  id: string
  kind: 'url' | 'text'
  mediaType: AtlasMediaType
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
  meta?: AtlasMeta | null
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

interface DocSheetCell {
  v: string
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  color?: string
  bg?: string
  rowSpan?: number
  colSpan?: number
  hidden?: boolean
}
interface DocSheet {
  name: string
  cols: number
  colWidths: number[]
  rows: DocSheetCell[][]
}
interface DocSlideRun {
  text: string
  size?: number
  bold?: boolean
  italic?: boolean
  color?: string
}
interface DocSlidePara {
  align?: 'left' | 'center' | 'right' | 'justify'
  runs: DocSlideRun[]
}
type DocSlideShape =
  | { type: 'text'; x: number; y: number; w: number; h: number; paras: DocSlidePara[] }
  | { type: 'image'; x: number; y: number; w: number; h: number; src: string }
interface DocSlide {
  w: number
  h: number
  shapes: DocSlideShape[]
}
type DocModel =
  | { kind: 'sheet'; sheets: DocSheet[]; truncated: boolean }
  | { kind: 'slides'; slides: DocSlide[] }

interface AtlasApi {
  saveUrl: (url: string) => Promise<AtlasSaveResult>
  saveText: (title: string, text: string) => Promise<AtlasSaveResult>
  saveFile: () => Promise<{ ok: boolean; item?: AtlasItem; name?: string; error?: string }[]>
  fileBytes: (
    id: string,
  ) => Promise<{ ok: boolean; bytes?: Uint8Array; mime?: string; name?: string; fileType?: string; error?: string }>
  docModel: (id: string) => Promise<{ ok: boolean; model?: DocModel; error?: string }>
  openFile: (id: string) => Promise<{ ok: boolean; error?: string }>
  digest: (id: string) => Promise<{ item: AtlasItem; warning: string | null }>
  list: (filters?: { query?: string; status?: AtlasStatus | 'queued'; tag?: string; domain?: string; shelf?: 'research' | 'none' }) => Promise<AtlasItem[]>
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
  interface LunaChatCard {
    module: 'orbit' | 'atlas' | 'file'
    action: string
    title: string
    subtitle?: string
    itemType?: string
    id?: string
    count?: number
    /** absolute path for a file card — powers in-app preview + reveal-in-folder */
    path?: string
    fileType?: string
  }

  type SoulFile = 'soul' | 'agents' | 'memory'
  interface LunaProfile {
    name: string
    callYou: string
    about: string
    address: 'casual' | 'formal' | 'minimal'
    wit: 'subtle' | 'balanced' | 'sharp'
    length: 'brief' | 'balanced' | 'thorough'
    format: 'lists' | 'prose' | 'auto'
    customInstructions: string
  }
  interface SoulSkillMeta {
    name: string
    description: string
    /** true for a default-seeded skill (can be reset to its shipped version) */
    builtin: boolean
  }
  interface SoulSkill {
    name: string
    description: string
    body: string
  }
  interface SoulApi {
    get: (file: SoulFile) => Promise<string>
    save: (file: SoulFile, content: string) => Promise<boolean>
    reset: (file: SoulFile) => Promise<string>
    skills: () => Promise<SoulSkillMeta[]>
    skillGet: (name: string) => Promise<SoulSkill | null>
    skillSave: (name: string, content: string) => Promise<{ ok: boolean; error?: string }>
    skillDelete: (name: string) => Promise<boolean>
    skillReset: (name: string) => Promise<{ ok: boolean; error?: string }>
    skillsRestore: () => Promise<{ ok: boolean; count: number }>
    openFolder: () => Promise<boolean>
    getProfile: () => Promise<LunaProfile>
    setProfile: (patch: Partial<LunaProfile>) => Promise<LunaProfile>
    onMemoryChanged: (cb: () => void) => () => void
  }

  type LlmProtocol = 'openai' | 'anthropic'
  type LlmSlot = 'main' | 'vision'
  interface LlmSlotConfig {
    protocol: LlmProtocol
    baseUrl: string
    model: string
    hasKey: boolean
  }
  interface LlmApi {
    get: () => Promise<{ main: LlmSlotConfig; vision: LlmSlotConfig }>
    setConfig: (slot: LlmSlot, patch: { protocol?: LlmProtocol; baseUrl?: string; model?: string }) => Promise<unknown>
    setKey: (slot: LlmSlot, key: string) => Promise<boolean>
    clearKey: (slot: LlmSlot) => Promise<boolean>
    test: (slot: LlmSlot) => Promise<{ ok: boolean; error?: string }>
  }

  interface LunaGrant {
    id: string
    path: string
    addedAt?: number
  }

  interface LunaActivity {
    id: string
    at: number
    action: string
    target: string
    ok: boolean
    detail?: string
  }

  interface LunaPermissionRequest {
    id: string
    action: string
    label: string
    target: string
    detail?: string
    tier: 'silent' | 'ask-once' | 'confirm'
  }

  interface LunaAttachment {
    name: string
    path?: string
    kind?: string
    text?: string
    truncated?: boolean
    error?: string
    /** self-contained downscaled JPEG data-URL for image attachments (thumbnail + viewer) */
    preview?: string
  }
}

interface FilesApi {
  workspace: () => Promise<{ workspace: string; grants: LunaGrant[] }>
  activity: (limit?: number) => Promise<LunaActivity[]>
  grants: () => Promise<LunaGrant[]>
  revoke: (id: string) => Promise<boolean>
  grantFolder: () => Promise<{ ok: boolean; grant?: LunaGrant; error?: string }>
  reveal: (path: string) => Promise<boolean>
  openWorkspace: () => Promise<boolean>
  readOutput: (
    path: string,
  ) => Promise<{ ok: boolean; bytes?: Uint8Array; mime?: string; name?: string; kind?: 'pdf' | 'image' | 'text'; error?: string }>
  attach: () => Promise<LunaAttachment[]>
  attachPaths: (paths: string[]) => Promise<LunaAttachment[]>
  attachData: (name: string, data: Uint8Array, mime?: string) => Promise<LunaAttachment>
  getPathForFile: (file: File) => string
  onPermissionRequest: (cb: (req: LunaPermissionRequest) => void) => () => void
  respondPermission: (id: string, approved: boolean) => void
  onActivity: (cb: (entry: LunaActivity) => void) => () => void
  onGrantsChanged: (cb: () => void) => () => void
}

declare global {
  interface LunaApi {
    minimize: () => void
    maximize: () => void
    close: () => void
    newWindow: () => void
    system: {
      getCloseToTray: () => Promise<boolean>
      setCloseToTray: (on: boolean) => Promise<boolean>
    }
    setZoom: (factor: number) => void
    onMaximized: (cb: (isMax: boolean) => void) => () => void
    saveKey: (provider: string, key: string) => Promise<boolean>
    hasKey: (provider: string) => Promise<boolean>
    clearKey: (provider: string) => Promise<boolean>
    llm: LlmApi
    chat: (
      req: { id?: string; messages: ChatMessage[]; temperature?: number; tools?: boolean; research?: boolean; identity?: boolean },
      onChunk: (token: string) => void,
      onStatus?: (status: string | null) => void,
      onCard?: (card: LunaChatCard) => void,
    ) => Promise<void>
    cancelChat: (id: string) => void
    files: FilesApi
    soul: SoulApi
    onOrbitCall: (handler: (name: string, args: string) => string) => () => void
    summarizeMeeting: (title: string, notes: string[]) => Promise<MeetingArtifacts>
    atlas: AtlasApi
    updates: UpdatesApi
  }
  interface Window {
    api?: LunaApi
  }
}
