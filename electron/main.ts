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

/** The single app window. Luna is a one-window app — only ever one of these exists. */
let mainWindow: BrowserWindow | null = null

/** The window a renderer IPC came from — window controls act on it. */
const senderWindow = (e: Electron.IpcMainEvent) => BrowserWindow.fromWebContents(e.sender)
/** The app window for a global action (native dialog parent, update banner target). */
const currentWindow = (): BrowserWindow | null => mainWindow

/** Create the one window, or reveal + focus it if it already exists. */
function createWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }

  const state = loadWindowState()
  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  mainWindow = win

  if (state.maximized) win.maximize()
  trackWindowState(win, state)

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { mainWindow = null })

  // links (e.g. in chat markdown) open in the system browser, never a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('maximize', () => win.webContents.send('win:maximized', true))
  win.on('unmaximize', () => win.webContents.send('win:maximized', false))

  // close-to-tray: hide to the tray instead of quitting (skipped during a real quit)
  win.on('close', (e) => {
    if (isQuitting || !getAppSettings().closeToTray) return
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

/** Reveal and focus the window (creating it if it was fully closed). */
function showWindow() {
  createWindow()
}

function ensureTray() {
  if (tray) return
  tray = new Tray(trayImage())
  tray.setToolTip('Luna')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Luna', click: showWindow },
      { type: 'separator' },
      { label: 'Quit Luna', click: () => { isQuitting = true; app.quit() } },
    ]),
  )
  tray.on('click', showWindow)
  tray.on('double-click', showWindow)
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

ipcMain.handle('app:get-close-to-tray', () => getAppSettings().closeToTray)
ipcMain.handle('app:set-close-to-tray', (_e, on: unknown) => {
  const value = !!on
  setAppSetting('closeToTray', value)
  // turning it off removes the tray icon — un-hide the window if it's tucked there so it isn't orphaned
  if (!value && mainWindow && !mainWindow.isVisible()) mainWindow.show()
  syncTray()
  return value
})

// single-window app: a second launch must not spin up another instance/window — it just
// reveals and focuses the one that's already running.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

app.on('second-instance', () => {
  showWindow()
})

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
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
  showWindow()
})
