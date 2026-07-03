import { app, BrowserWindow, ipcMain, shell } from 'electron'
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

process.env.APP_ROOT = path.join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

let win: BrowserWindow | null = null

function createWindow() {
  const state = loadWindowState()

  win = new BrowserWindow({
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

  if (state.maximized) win.maximize()
  trackWindowState(win, state)

  win.once('ready-to-show', () => win?.show())

  // links (e.g. in chat markdown) open in the system browser, never a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('maximize', () => win?.webContents.send('win:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('win:maximized', false))

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

ipcMain.on('win:minimize', () => win?.minimize())
ipcMain.on('win:maximize', () => {
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})
ipcMain.on('win:close', () => win?.close())

app.whenReady().then(() => {
  registerKeychain()
  registerLlm()
  registerLuna()
  registerMeeting()
  registerAtlas(() => win)
  registerLunaFs()
  registerSoul()
  createWindow()
  registerUpdater(() => win)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
