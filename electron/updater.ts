import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

/**
 * Notify-and-confirm GitHub updater. We never auto-download: the app checks on
 * launch, tells the renderer when a version is available, and only downloads /
 * installs when the user asks. All update flow is packaged-only — in dev there is
 * no app-update.yml, so checks are short-circuited.
 */
export function registerUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // broadcast so the update banner appears in every open window
  const send = (channel: string, payload?: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }

  autoUpdater.on('checking-for-update', () => send('updates:checking'))
  autoUpdater.on('update-available', (info) => send('updates:available', { version: info.version }))
  autoUpdater.on('update-not-available', () => send('updates:none'))
  autoUpdater.on('error', (err) => send('updates:error', err instanceof Error ? err.message : String(err)))
  autoUpdater.on('download-progress', (p) => send('updates:progress', Math.round(p.percent)))
  autoUpdater.on('update-downloaded', (info) => send('updates:downloaded', { version: info.version }))

  ipcMain.handle('updates:version', () => app.getVersion())

  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) return { ok: false, reason: 'dev' }
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('updates:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.on('updates:install', () => autoUpdater.quitAndInstall())

  // Quiet auto-check a few seconds after launch (packaged only).
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 3000)
  }
}
