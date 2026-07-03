import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AtlasItem } from './db'

/**
 * The Atlas file vault. When a local document is filed into Atlas we copy the original bytes
 * into an app-managed folder (userData/atlas-vault) and remember the copy's name on the item's
 * meta (`vaultFile`). The built-in document viewer then renders from that copy, so the library
 * keeps working even if the user later moves, renames or deletes the source file. Copies are
 * named by a random id (never the original name) so two files that share a name can't collide.
 */

const MAX_COPY_BYTES = 60 * 1024 * 1024 // don't vault monsters; viewer falls back to text

let dir: string | null = null
export function vaultDir(): string {
  if (!dir) {
    dir = path.join(app.getPath('userData'), 'atlas-vault')
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** Copy a source file into the vault. Returns the stored filename, or null if it couldn't be copied. */
export function copyToVault(sourcePath: string, fileType?: string): string | null {
  try {
    const size = fs.statSync(sourcePath).size
    if (size > MAX_COPY_BYTES) return null
    const ext = (fileType || path.extname(sourcePath).replace(/^\./, '') || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
    const name = `${crypto.randomUUID()}.${ext}`
    fs.copyFileSync(sourcePath, path.join(vaultDir(), name))
    return name
  } catch {
    return null
  }
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
export const mimeFor = (ext: string): string => MIME[ext.toLowerCase()] ?? 'application/octet-stream'

/** Read the vaulted bytes for an item, or null if it has no (readable) copy. */
export function readVaultBytes(item: AtlasItem): { bytes: Buffer; mime: string; name: string } | null {
  const file = item.meta?.vaultFile
  if (!file) return null
  try {
    const full = path.join(vaultDir(), path.basename(file)) // basename → can't escape the vault
    const bytes = fs.readFileSync(full)
    const ext = path.extname(file).replace(/^\./, '')
    return { bytes, mime: mimeFor(ext), name: item.title }
  } catch {
    return null
  }
}

/** Remove an item's vault copy (called when the item is deleted). Best-effort. */
export function deleteVault(item: AtlasItem | null | undefined): void {
  const file = item?.meta?.vaultFile
  if (!file) return
  try {
    fs.rmSync(path.join(vaultDir(), path.basename(file)), { force: true })
  } catch {
    /* already gone */
  }
}
