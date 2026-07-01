import { BrowserWindow } from 'electron'
import { USER_AGENT } from './constants'

/**
 * Tier 2: render the page in a hidden, sandboxed window and return the post-JS DOM.
 * Used only when the plain HTTP fetch comes back thin or fails (JS-gated pages). The
 * window is isolated (no node integration, dedicated in-memory session, images blocked)
 * and destroyed after each fetch.
 */
export async function renderHtml(url: string, signal: AbortSignal, timeoutMs = 22000): Promise<string> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: 'luna-fetch',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      images: false,
      javascript: true,
      autoplayPolicy: 'document-user-activation-required',
    },
  })

  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.setUserAgent(USER_AGENT)

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('render timeout')), timeoutMs),
  )
  const aborted = new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
  )

  try {
    await Promise.race([win.loadURL(url), timeout, aborted])
    await Promise.race([new Promise((r) => setTimeout(r, 450)), aborted])
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML')
    return typeof html === 'string' ? html : ''
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
