import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Small persisted store for main-process app preferences — settings whose behavior lives in the
 * main process (window/tray lifecycle) rather than the renderer. Kept separate from the renderer's
 * Zustand settings, which can't drive native window behavior. Persisted to userData as JSON.
 */

export interface AppSettings {
  /** hide the window to the system tray on close instead of quitting */
  closeToTray: boolean
}

const DEFAULTS: AppSettings = { closeToTray: false }

const file = () => path.join(app.getPath('userData'), 'luna-app-settings.json')

let cache: AppSettings | null = null

export function getAppSettings(): AppSettings {
  if (cache) return cache
  try {
    cache = { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<AppSettings>) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export function setAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): AppSettings {
  const next = { ...getAppSettings(), [key]: value }
  cache = next
  try {
    fs.writeFileSync(file(), JSON.stringify(next))
  } catch {
    // best-effort — a lost preference isn't worth crashing over
  }
  return next
}
