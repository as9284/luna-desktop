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
  // "Searching the web…", cleared with null); resolves on done, rejects on error
  chat: (
    req: { messages: { role: string; content: string }[]; temperature?: number },
    onChunk: (token: string) => void,
    onStatus?: (status: string | null) => void,
  ) =>
    new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID()
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
      ipcRenderer.send('luna:chat', { id, ...req })
    }),

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
