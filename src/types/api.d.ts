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
      req: { messages: ChatMessage[]; temperature?: number },
      onChunk: (token: string) => void,
      onStatus?: (status: string | null) => void,
    ) => Promise<void>
    summarizeMeeting: (title: string, notes: string[]) => Promise<MeetingArtifacts>
    updates: UpdatesApi
  }
  interface Window {
    api?: LunaApi
  }
}
