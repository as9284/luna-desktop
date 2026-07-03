import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { guardPath, type GuardConfig } from './paths'

/**
 * The filesystem operations Luna's tools call. Every op goes through the path guard, and
 * the destructive ones honor the user's chosen safety net:
 *  - overwrite  → the existing file is copied to a timestamped backup first
 *  - delete     → the file is sent to the OS Recycle Bin (never hard-unlinked)
 *
 * Electron bits (guard config, trash, backup location, logging) are injected so the whole
 * module runs — and is tested — under plain Node.
 */

export interface FsOpsDeps {
  /** current guard config (roots + denylist); read fresh each call so new grants take effect */
  getGuard: () => GuardConfig
  /** send a path to the OS Recycle Bin (electron shell.trashItem in prod) */
  trash: (p: string) => Promise<void>
  /** directory where overwrite backups are stored (outside any granted root) */
  backupDir: string
  /** record an activity-log entry */
  log?: (entry: { action: string; target: string; ok: boolean; detail?: string }) => void
}

const MAX_READ_BYTES = 12 * 1024 * 1024 // 12 MB raw read cap
const MAX_DIR_ENTRIES = 2000

export type FileType = 'file' | 'dir' | 'other'

const typeOf = (s: fs.Stats): FileType => (s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other')

const stamp = (d = new Date()) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-` +
  `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`

export function createFsOps(deps: FsOpsDeps) {
  const guard = (p: string) => guardPath(p, deps.getGuard())
  const note = (action: string, target: string, ok: boolean, detail?: string) =>
    deps.log?.({ action, target, ok, detail })

  /** Copy an existing file to a timestamped backup outside every granted root. */
  const backup = (real: string): string => {
    fs.mkdirSync(deps.backupDir, { recursive: true })
    const dest = path.join(deps.backupDir, `${stamp()}-${path.basename(real)}`)
    fs.copyFileSync(real, dest)
    return dest
  }

  return {
    async readFile(input: string): Promise<
      { ok: true; path: string; text: string; bytes: number; truncated: boolean } | { ok: false; error: string }
    > {
      const g = guard(input)
      if (!g.ok) return note('read', input, false, g.error), { ok: false, error: g.error }
      try {
        const st = await fsp.stat(g.real)
        if (st.isDirectory()) return { ok: false, error: 'That path is a folder — use list_dir.' }
        const truncated = st.size > MAX_READ_BYTES
        const fh = await fsp.open(g.real, 'r')
        try {
          const len = Math.min(st.size, MAX_READ_BYTES)
          const buf = Buffer.alloc(len)
          await fh.read(buf, 0, len, 0)
          note('read', g.real, true)
          return { ok: true, path: g.real, text: buf.toString('utf8'), bytes: st.size, truncated }
        } finally {
          await fh.close()
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        return note('read', input, false, error), { ok: false, error }
      }
    },

    async listDir(input: string): Promise<
      { ok: true; path: string; entries: { name: string; type: FileType; size: number }[]; truncated: boolean }
      | { ok: false; error: string }
    > {
      const g = guard(input)
      if (!g.ok) return note('list', input, false, g.error), { ok: false, error: g.error }
      try {
        const names = await fsp.readdir(g.real)
        const slice = names.slice(0, MAX_DIR_ENTRIES)
        const entries = await Promise.all(
          slice.map(async (name) => {
            try {
              const st = await fsp.stat(path.join(g.real, name))
              return { name, type: typeOf(st), size: st.isFile() ? st.size : 0 }
            } catch {
              return { name, type: 'other' as FileType, size: 0 }
            }
          }),
        )
        note('list', g.real, true)
        return { ok: true, path: g.real, entries, truncated: names.length > MAX_DIR_ENTRIES }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        return note('list', input, false, error), { ok: false, error }
      }
    },

    async stat(input: string): Promise<
      { ok: true; path: string; type: FileType; size: number; modified: number } | { ok: false; error: string }
    > {
      const g = guard(input)
      if (!g.ok) return { ok: false, error: g.error }
      try {
        const st = await fsp.stat(g.real)
        return { ok: true, path: g.real, type: typeOf(st), size: st.size, modified: st.mtimeMs }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    /** Whether a write would create a new file or overwrite an existing one (drives approval tier). */
    writeKind(input: string): 'create' | 'overwrite' | null {
      const g = guard(input)
      if (!g.ok) return null
      return fs.existsSync(g.real) ? 'overwrite' : 'create'
    },

    async writeFile(input: string, content: string): Promise<
      { ok: true; path: string; action: 'create' | 'overwrite'; backup?: string; bytes: number }
      | { ok: false; error: string }
    > {
      const g = guard(input)
      if (!g.ok) return note('write', input, false, g.error), { ok: false, error: g.error }
      try {
        const exists = fs.existsSync(g.real)
        if (exists && fs.statSync(g.real).isDirectory()) return { ok: false, error: 'That path is a folder.' }
        let backupPath: string | undefined
        if (exists) backupPath = backup(g.real)
        await fsp.mkdir(path.dirname(g.real), { recursive: true })
        await fsp.writeFile(g.real, content, 'utf8')
        const action = exists ? 'overwrite' : 'create'
        note(action, g.real, true, backupPath ? `backup: ${backupPath}` : undefined)
        return { ok: true, path: g.real, action, backup: backupPath, bytes: Buffer.byteLength(content, 'utf8') }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        return note('write', input, false, error), { ok: false, error }
      }
    },

    /** Write raw bytes (e.g. a rendered PDF). Same guard + backup-on-overwrite path as writeFile. */
    async writeBytes(input: string, data: Uint8Array): Promise<
      { ok: true; path: string; action: 'create' | 'overwrite'; backup?: string; bytes: number }
      | { ok: false; error: string }
    > {
      const g = guard(input)
      if (!g.ok) return note('write', input, false, g.error), { ok: false, error: g.error }
      try {
        const exists = fs.existsSync(g.real)
        if (exists && fs.statSync(g.real).isDirectory()) return { ok: false, error: 'That path is a folder.' }
        let backupPath: string | undefined
        if (exists) backupPath = backup(g.real)
        await fsp.mkdir(path.dirname(g.real), { recursive: true })
        await fsp.writeFile(g.real, data)
        const action = exists ? 'overwrite' : 'create'
        note(action, g.real, true, backupPath ? `backup: ${backupPath}` : undefined)
        return { ok: true, path: g.real, action, backup: backupPath, bytes: data.byteLength }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        return note('write', input, false, error), { ok: false, error }
      }
    },

    async makeDir(input: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
      const g = guard(input)
      if (!g.ok) return { ok: false, error: g.error }
      try {
        await fsp.mkdir(g.real, { recursive: true })
        note('mkdir', g.real, true)
        return { ok: true, path: g.real }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    /** Delete = move to the Recycle Bin. Never a hard unlink, so it's always recoverable. */
    async deleteFile(input: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
      const g = guard(input)
      if (!g.ok) return note('delete', input, false, g.error), { ok: false, error: g.error }
      try {
        if (!fs.existsSync(g.real)) return { ok: false, error: 'That path does not exist.' }
        await deps.trash(g.real)
        note('delete', g.real, true, 'moved to Recycle Bin')
        return { ok: true, path: g.real }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        return note('delete', input, false, error), { ok: false, error }
      }
    },
  }
}

export type FsOps = ReturnType<typeof createFsOps>
