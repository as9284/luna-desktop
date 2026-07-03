import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { registerKeychain } from './ipc/keychain'
import { registerLuna } from './ipc/luna'
import { registerMeeting } from './ipc/meeting'
import { registerAtlas } from './atlas'
import { registerLunaFs } from './luna'
import { registerLlm } from './llm'
import { registerSoul } from './soul'
import { registerUpdater } from './updater'
import { loadWindowState, trackWindowState, MIN_WIDTH, MIN_HEIGHT } from './window-state'
import { getAppSettings, setAppSetting } from './app-settings'

process.env.APP_ROOT = path.join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

let tray: Tray | null = null
/** true only during a real quit, so the close-to-tray handler lets windows actually close */
let isQuitting = false

/** The window a renderer IPC came from — window controls act on their own window, not a global one. */
const senderWindow = (e: Electron.IpcMainEvent) => BrowserWindow.fromWebContents(e.sender)
/** Best window for a global action (native dialog parent, update banner target). */
const currentWindow = (): BrowserWindow | null =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

function createWindow(): BrowserWindow {
  const isFirst = BrowserWindow.getAllWindows().length === 0
  const state = loadWindowState()

  // the first window restores the saved size/position; extra windows cascade off the focused one
  let bounds = state.bounds
  if (!isFirst) {
    const ref = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(-1)
    const b = ref?.getBounds()
    bounds = b ? { width: b.width, height: b.height, x: b.x + 34, y: b.y + 34 } : { width: state.bounds.width, height: state.bounds.height }
  }

  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // only the primary window restores maximized state and persists its bounds, so extra
  // windows don't fight over the single saved-state file
  if (isFirst && state.maximized) win.maximize()
  if (isFirst) trackWindowState(win, state)

  win.once('ready-to-show', () => win.show())

  // links (e.g. in chat markdown) open in the system browser, never a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('maximize', () => win.webContents.send('win:maximized', true))
  win.on('unmaximize', () => win.webContents.send('win:maximized', false))

  // close-to-tray: the last visible window hides to the tray instead of quitting; extra
  // windows close normally. Skipped entirely during a real quit.
  win.on('close', (e) => {
    if (isQuitting || !getAppSettings().closeToTray) return
    const othersVisible = BrowserWindow.getAllWindows().some((w) => w !== win && !w.isDestroyed() && w.isVisible())
    if (othersVisible) return
    e.preventDefault()
    win.hide()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
  return win
}

/* ---------------- system tray (close-to-tray) ---------------- */

function trayImage(): Electron.NativeImage {
  // packaged: build/icon.png is copied to resources via electron-builder extraResources.
  // dev: read it straight from the project's build/ dir.
  for (const p of [path.join(process.resourcesPath ?? '', 'icon.png'), path.join(process.env.APP_ROOT ?? '', 'build', 'icon.png')]) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) return img.resize({ width: 16, height: 16 })
      }
    } catch {
      // try the next candidate
    }
  }
  return nativeImage.createEmpty()
}

function showAllWindows() {
  const wins = BrowserWindow.getAllWindows()
  if (wins.length === 0) {
    createWindow()
    return
  }
  for (const w of wins) {
    if (!w.isVisible()) w.show()
    w.focus()
  }
}

function ensureTray() {
  if (tray) return
  tray = new Tray(trayImage())
  tray.setToolTip('Luna')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Luna', click: showAllWindows },
      { label: 'New window', click: () => createWindow() },
      { type: 'separator' },
      { label: 'Quit Luna', click: () => { isQuitting = true; app.quit() } },
    ]),
  )
  tray.on('click', showAllWindows)
  tray.on('double-click', showAllWindows)
}

function destroyTray() {
  tray?.destroy()
  tray = null
}

/** The tray only exists while close-to-tray is on, so users who leave it off get no tray icon. */
function syncTray() {
  if (getAppSettings().closeToTray) ensureTray()
  else destroyTray()
}

/* ---------------- window-control IPC ---------------- */

ipcMain.on('win:minimize', (e) => senderWindow(e)?.minimize())
ipcMain.on('win:maximize', (e) => {
  const w = senderWindow(e)
  if (!w) return
  if (w.isMaximized()) w.unmaximize()
  else w.maximize()
})
ipcMain.on('win:close', (e) => senderWindow(e)?.close())
ipcMain.on('win:new', () => createWindow())

ipcMain.handle('app:get-close-to-tray', () => getAppSettings().closeToTray)
ipcMain.handle('app:set-close-to-tray', (_e, on: unknown) => {
  const value = !!on
  setAppSetting('closeToTray', value)
  // turning it off removes the tray icon — un-hide any window tucked there so it isn't orphaned
  if (!value) for (const w of BrowserWindow.getAllWindows()) if (!w.isVisible()) w.show()
  syncTray()
  return value
})

app.whenReady().then(() => {
  registerKeychain()
  registerLlm()
  registerLuna()
  registerMeeting()
  registerAtlas(currentWindow)
  registerLunaFs()
  registerSoul()
  createWindow()
  registerUpdater()
  syncTray()
})

// any deliberate quit (menu, updater install, OS shutdown) must bypass close-to-tray
app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else showAllWindows()
})
