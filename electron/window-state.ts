import { app, screen, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface Bounds {
  width: number
  height: number
  x?: number
  y?: number
}
interface WindowState {
  bounds: Bounds
  maximized: boolean
}

export const MIN_WIDTH = 960
export const MIN_HEIGHT = 640
const DEFAULT_BOUNDS: Bounds = { width: 1280, height: 800 }

const file = () => path.join(app.getPath('userData'), 'window-state.json')

function load(): WindowState {
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<WindowState>
    return { bounds: { ...DEFAULT_BOUNDS, ...data.bounds }, maximized: !!data.maximized }
  } catch {
    return { bounds: DEFAULT_BOUNDS, maximized: false }
  }
}

function save(state: WindowState) {
  try {
    fs.writeFileSync(file(), JSON.stringify(state))
  } catch {
    // best-effort — losing the last window size isn't worth crashing over
  }
}

/** Falls back to the default position if the saved one is now off every display (monitor unplugged, etc). */
function clampToVisibleArea(bounds: Bounds): Bounds {
  if (bounds.x === undefined || bounds.y === undefined) return bounds
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return bounds.x! >= a.x && bounds.y! >= a.y && bounds.x! < a.x + a.width && bounds.y! < a.y + a.height
  })
  return onScreen ? bounds : { width: bounds.width, height: bounds.height }
}

export function loadWindowState(): WindowState {
  const state = load()
  const bounds = clampToVisibleArea(state.bounds)
  return {
    ...state,
    bounds: { ...bounds, width: Math.max(bounds.width, MIN_WIDTH), height: Math.max(bounds.height, MIN_HEIGHT) },
  }
}

/** Persists bounds (while restored, not maximized) and the maximized flag as the window changes. */
export function trackWindowState(win: BrowserWindow, initial: WindowState) {
  let restoredBounds = initial.bounds
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    if (!maximized && !win.isMinimized()) restoredBounds = win.getBounds()
    save({ bounds: restoredBounds, maximized })
  }

  const scheduleFlush = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, 400)
  }

  win.on('resize', scheduleFlush)
  win.on('move', scheduleFlush)
  win.on('maximize', flush)
  win.on('unmaximize', flush)
  win.on('close', flush)
}
