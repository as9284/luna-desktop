import { app, ipcMain, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const file = () => path.join(app.getPath('userData'), 'luna-keys.json')

function load(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'))
  } catch {
    return {}
  }
}

function persist(o: Record<string, string>) {
  fs.writeFileSync(file(), JSON.stringify(o))
}

/** Decrypt and return a stored key (main process only — never sent to the renderer). */
export function getKey(provider: string): string | null {
  const enc = load()[provider]
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

/** Encrypt and store a key (main-process helper, e.g. for migrations). Empty clears it. */
export function setKey(provider: string, key: string) {
  const o = load()
  if (key) o[provider] = safeStorage.encryptString(key).toString('base64')
  else delete o[provider]
  persist(o)
}

export function registerKeychain() {
  ipcMain.handle('keychain:save', (_e, provider: string, key: string) => {
    const o = load()
    if (key) o[provider] = safeStorage.encryptString(key).toString('base64')
    else delete o[provider]
    persist(o)
    return true
  })
  ipcMain.handle('keychain:has', (_e, provider: string) => !!load()[provider])
  ipcMain.handle('keychain:clear', (_e, provider: string) => {
    const o = load()
    delete o[provider]
    persist(o)
    return true
  })
}
