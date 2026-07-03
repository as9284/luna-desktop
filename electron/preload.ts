import { contextBridge, ipcRenderer, webUtils, webFrame } from 'electron'

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  // interface scale: true page zoom (reflows to fit the window, covers portaled UI)
  setZoom: (factor: number) => webFrame.setZoomFactor(factor),
  onMaximized: (cb: (isMax: boolean) => void) => {
    const handler = (_e: unknown, isMax: boolean) => cb(isMax)
    ipcRenderer.on('win:maximized', handler)
    return () => ipcRenderer.off('win:maximized', handler)
  },

  // encrypted API keys (handled in the main process via safeStorage)
  saveKey: (provider: string, key: string) => ipcRenderer.invoke('keychain:save', provider, key),
  hasKey: (provider: string) => ipcRenderer.invoke('keychain:has', provider),
  clearKey: (provider: string) => ipcRenderer.invoke('keychain:clear', provider),

  // universal model config: main (chat) + vision (image) slots, each any OpenAI/Anthropic endpoint
  llm: {
    get: () => ipcRenderer.invoke('llm:get'),
    setConfig: (slot: string, patch: { protocol?: string; baseUrl?: string; model?: string }) =>
      ipcRenderer.invoke('llm:set-config', slot, patch),
    setKey: (slot: string, key: string) => ipcRenderer.invoke('llm:set-key', slot, key),
    clearKey: (slot: string) => ipcRenderer.invoke('llm:clear-key', slot),
    test: (slot: string) => ipcRenderer.invoke('llm:test', slot),
  },

  // Luna's identity: soul / rules / memory files + skills (edited in the Settings "Luna" panel)
  soul: {
    get: (file: string) => ipcRenderer.invoke('soul:get', file),
    save: (file: string, content: string) => ipcRenderer.invoke('soul:save', file, content),
    reset: (file: string) => ipcRenderer.invoke('soul:reset', file),
    skills: () => ipcRenderer.invoke('soul:skills'),
    skillGet: (name: string) => ipcRenderer.invoke('soul:skill-get', name),
    skillSave: (name: string, content: string) => ipcRenderer.invoke('soul:skill-save', name, content),
    skillDelete: (name: string) => ipcRenderer.invoke('soul:skill-delete', name),
    skillReset: (name: string) => ipcRenderer.invoke('soul:skill-reset', name),
    skillsRestore: () => ipcRenderer.invoke('soul:skills-restore'),
    openFolder: () => ipcRenderer.invoke('soul:open-folder'),
    getProfile: () => ipcRenderer.invoke('soul:profile-get'),
    setProfile: (patch: Record<string, unknown>) => ipcRenderer.invoke('soul:profile-set', patch),
    onMemoryChanged: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('soul:memory-changed', handler)
      return () => ipcRenderer.removeListener('soul:memory-changed', handler)
    },
  },

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
      identity?: boolean
    },
    onChunk: (token: string) => void,
    onStatus?: (status: string | null) => void,
    onCard?: (card: unknown) => void,
  ) =>
    new Promise<void>((resolve, reject) => {
      const id = req.id ?? crypto.randomUUID()
      const chunkCh = `luna:chunk:${id}`
      const statusCh = `luna:status:${id}`
      const cardCh = `luna:card:${id}`
      const doneCh = `luna:done:${id}`
      const errCh = `luna:err:${id}`
      const onC = (_e: unknown, token: string) => onChunk(token)
      const onS = (_e: unknown, status: string | null) => onStatus?.(status)
      const onCd = (_e: unknown, card: unknown) => onCard?.(card)
      const cleanup = () => {
        ipcRenderer.removeListener(chunkCh, onC)
        ipcRenderer.removeListener(statusCh, onS)
        ipcRenderer.removeListener(cardCh, onCd)
      }
      ipcRenderer.on(chunkCh, onC)
      ipcRenderer.on(statusCh, onS)
      ipcRenderer.on(cardCh, onCd)
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

  // Luna's file/code capabilities: workspace + granted folders, activity log, permissions
  files: {
    workspace: () => ipcRenderer.invoke('luna:fs-workspace'),
    activity: (limit?: number) => ipcRenderer.invoke('luna:fs-activity', limit),
    grants: () => ipcRenderer.invoke('luna:fs-grants'),
    revoke: (id: string) => ipcRenderer.invoke('luna:fs-revoke', id),
    grantFolder: () => ipcRenderer.invoke('luna:fs-grant-folder'),
    reveal: (path: string) => ipcRenderer.invoke('luna:fs-reveal', path),
    openWorkspace: () => ipcRenderer.invoke('luna:fs-open-workspace'),
    attach: () => ipcRenderer.invoke('luna:fs-attach'),
    attachPaths: (paths: string[]) => ipcRenderer.invoke('luna:fs-attach-paths', paths),
    // pasted clipboard image bytes → vision text + a thumbnail preview
    attachData: (name: string, data: Uint8Array, mime?: string) => ipcRenderer.invoke('luna:fs-attach-data', name, data, mime),
    // resolve the absolute path of a drag-dropped File (Electron removed File.path in v32+)
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    // Luna asks to write / delete / run code → renderer shows an inline permission card
    onPermissionRequest: (cb: (req: { id: string; action: string; label: string; target: string; detail?: string; tier: string }) => void) => {
      const handler = (_e: unknown, req: { id: string; action: string; label: string; target: string; detail?: string; tier: string }) => cb(req)
      ipcRenderer.on('luna:permission-request', handler)
      return () => ipcRenderer.removeListener('luna:permission-request', handler)
    },
    respondPermission: (id: string, approved: boolean) => ipcRenderer.send(`luna:permission-response:${id}`, { approved }),
    // live activity + grant-change feeds for the edge drawer
    onActivity: (cb: (entry: { id: string; at: number; action: string; target: string; ok: boolean; detail?: string }) => void) => {
      const handler = (_e: unknown, entry: { id: string; at: number; action: string; target: string; ok: boolean; detail?: string }) => cb(entry)
      ipcRenderer.on('luna:fs-activity', handler)
      return () => ipcRenderer.removeListener('luna:fs-activity', handler)
    },
    onGrantsChanged: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('luna:fs-grants-changed', handler)
      return () => ipcRenderer.removeListener('luna:fs-grants-changed', handler)
    },
  },

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
    saveFile: () => ipcRenderer.invoke('atlas:save-file'),
    fileBytes: (id: string) => ipcRenderer.invoke('atlas:file-bytes', id),
    docModel: (id: string) => ipcRenderer.invoke('atlas:doc-model', id),
    openFile: (id: string) => ipcRenderer.invoke('atlas:open-file', id),
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
