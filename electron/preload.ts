import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  onMaximized: (cb: (isMax: boolean) => void) => {
    const handler = (_e: unknown, isMax: boolean) => cb(isMax)
    ipcRenderer.on('win:maximized', handler)
    return () => ipcRenderer.off('win:maximized', handler)
  },

  // encrypted API keys (handled in the main process via safeStorage)
  saveKey: (provider: string, key: string) => ipcRenderer.invoke('keychain:save', provider, key),
  hasKey: (provider: string) => ipcRenderer.invoke('keychain:has', provider),
  clearKey: (provider: string) => ipcRenderer.invoke('keychain:clear', provider),

  // meeting wrap-up: turn raw meeting notes into an organized note + tasks + project
  summarizeMeeting: (title: string, notes: string[]) => ipcRenderer.invoke('meeting:summarize', { title, notes }),

  // streaming chat — onChunk is called per token, onStatus for transient state (e.g.
  // "Searching the web…", cleared with null); resolves on done, rejects on error.
  // Pass req.id to be able to cancel the request later via cancelChat(id).
  chat: (
    req: {
      id?: string
      messages: { role: string; content: string }[]
      temperature?: number
      tools?: boolean
      research?: boolean
    },
    onChunk: (token: string) => void,
    onStatus?: (status: string | null) => void,
  ) =>
    new Promise<void>((resolve, reject) => {
      const id = req.id ?? crypto.randomUUID()
      const chunkCh = `luna:chunk:${id}`
      const statusCh = `luna:status:${id}`
      const doneCh = `luna:done:${id}`
      const errCh = `luna:err:${id}`
      const onC = (_e: unknown, token: string) => onChunk(token)
      const onS = (_e: unknown, status: string | null) => onStatus?.(status)
      const cleanup = () => {
        ipcRenderer.removeListener(chunkCh, onC)
        ipcRenderer.removeListener(statusCh, onS)
      }
      ipcRenderer.on(chunkCh, onC)
      ipcRenderer.on(statusCh, onS)
      ipcRenderer.once(doneCh, () => {
        cleanup()
        resolve()
      })
      ipcRenderer.once(errCh, (_e: unknown, msg: string) => {
        cleanup()
        reject(new Error(msg))
      })
      ipcRenderer.send('luna:chat', { ...req, id })
    }),

  // abort an in-flight chat request; the stream resolves normally with partial content
  cancelChat: (id: string) => ipcRenderer.send('luna:cancel', id),

  // Orbit tool calls from Luna: the main process asks the renderer (where the Orbit
  // store lives) to execute a tool and reply with a JSON result string
  onOrbitCall: (handler: (name: string, args: string) => string) => {
    const listener = (_e: unknown, call: { invokeId: string; name: string; args: string }) => {
      let result: string
      try {
        result = handler(call.name, call.args)
      } catch (err) {
        result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
      }
      ipcRenderer.send(`luna:orbit-result:${call.invokeId}`, result)
    }
    ipcRenderer.on('luna:orbit-call', listener)
    return () => ipcRenderer.removeListener('luna:orbit-call', listener)
  },

  // Atlas — the research library. All data lives in SQLite in the main process.
  atlas: {
    saveUrl: (url: string) => ipcRenderer.invoke('atlas:save-url', url),
    saveText: (title: string, text: string) => ipcRenderer.invoke('atlas:save-text', title, text),
    digest: (id: string) => ipcRenderer.invoke('atlas:digest', id),
    list: (filters?: { query?: string; status?: string; tag?: string; domain?: string }) =>
      ipcRenderer.invoke('atlas:list', filters ?? {}),
    get: (id: string) => ipcRenderer.invoke('atlas:get', id),
    update: (
      id: string,
      patch: { title?: string; status?: string; queuedAt?: number | null; scroll?: number; tags?: string[] },
    ) => ipcRenderer.invoke('atlas:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('atlas:delete', id),
    addHighlight: (itemId: string, text: string, note?: string) =>
      ipcRenderer.invoke('atlas:highlight-add', itemId, text, note),
    noteHighlight: (id: string, note: string) => ipcRenderer.invoke('atlas:highlight-note', id, note),
    removeHighlight: (id: string) => ipcRenderer.invoke('atlas:highlight-delete', id),
    highlights: (query?: string) => ipcRenderer.invoke('atlas:highlights', query),
    related: (id: string) => ipcRenderer.invoke('atlas:related', id),
    facets: () => ipcRenderer.invoke('atlas:facets'),
    exportItems: (ids: string[]) => ipcRenderer.invoke('atlas:export', ids),
    // fires after any library mutation (including ones Luna makes) so open views refresh
    onChanged: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('atlas:changed', handler)
      return () => ipcRenderer.removeListener('atlas:changed', handler)
    },
  },

  // GitHub auto-updates (notify & confirm)
  updates: {
    version: () => ipcRenderer.invoke('updates:version'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.send('updates:install'),
    onEvent: (cb: (evt: { type: string; payload?: unknown }) => void) => {
      const channels = [
        'updates:checking',
        'updates:available',
        'updates:none',
        'updates:error',
        'updates:progress',
        'updates:downloaded',
      ]
      const offs = channels.map((ch) => {
        const handler = (_e: unknown, payload: unknown) => cb({ type: ch.slice('updates:'.length), payload })
        ipcRenderer.on(ch, handler)
        return () => ipcRenderer.removeListener(ch, handler)
      })
      return () => offs.forEach((off) => off())
    },
  },
})
