import fs from 'node:fs'
import path from 'node:path'
import { buildDenylist } from './denylist'
import { normalizeRoots, realOf, isInside, type GuardConfig } from './paths'

/**
 * The grant registry + the default workspace.
 *
 * Boundary model the user chose: a default "Luna" workspace folder is always available,
 * and any other folder must be explicitly granted. This store persists grants to a small
 * JSON file in Luna's app-data dir and hands the path guard its live root/denylist set.
 *
 * Injectable dirs (home / userData / documents) keep it testable without Electron.
 */

export interface Grant {
  id: string
  path: string
  addedAt: number
}

export interface GrantDirs {
  home: string
  userData: string
  documents: string
}

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)

export function createGrantStore(dirs: GrantDirs) {
  const workspacePath = path.join(dirs.documents, 'Luna')
  const grantsFile = path.join(dirs.userData, 'luna-grants.json')
  const denylist = normalizeRoots(buildDenylist({ home: dirs.home, userData: dirs.userData }))

  const ensureWorkspace = (): string => {
    try {
      fs.mkdirSync(workspacePath, { recursive: true })
    } catch {
      // if Documents/Luna can't be made, fall back to app-data so the app still works
      const fallback = path.join(dirs.userData, 'workspace')
      fs.mkdirSync(fallback, { recursive: true })
      return realOf(fallback)
    }
    return realOf(workspacePath)
  }

  const readGrants = (): Grant[] => {
    try {
      const raw = JSON.parse(fs.readFileSync(grantsFile, 'utf8'))
      if (!Array.isArray(raw)) return []
      return raw.filter((g): g is Grant => g && typeof g.path === 'string' && typeof g.id === 'string')
    } catch {
      return []
    }
  }

  const writeGrants = (grants: Grant[]) => {
    fs.writeFileSync(grantsFile, JSON.stringify(grants, null, 2))
  }

  const list = (): Grant[] => readGrants().filter((g) => fs.existsSync(g.path))

  const add = (dir: string): { ok: true; grant: Grant } | { ok: false; error: string } => {
    if (!dir) return { ok: false, error: 'No folder provided.' }
    let real: string
    try {
      if (!fs.existsSync(dir)) return { ok: false, error: 'That folder does not exist.' }
      if (!fs.statSync(dir).isDirectory()) return { ok: false, error: 'That path is not a folder.' }
      real = realOf(dir)
    } catch {
      return { ok: false, error: 'Could not read that folder.' }
    }
    // a folder inside the protected denylist can never be granted
    if (denylist.some((d) => isInside(d, real))) {
      return { ok: false, error: 'That folder is inside a protected location and cannot be granted.' }
    }
    const grants = readGrants()
    const existing = grants.find((g) => realOf(g.path) === real)
    if (existing) return { ok: true, grant: existing }
    const grant: Grant = { id: uid(), path: real, addedAt: Date.now() }
    grants.push(grant)
    writeGrants(grants)
    return { ok: true, grant }
  }

  const remove = (id: string): boolean => {
    const grants = readGrants()
    const next = grants.filter((g) => g.id !== id)
    if (next.length === grants.length) return false
    writeGrants(next)
    return true
  }

  /** The live set of roots Luna may touch: the workspace plus every granted folder. */
  const roots = (): string[] => normalizeRoots([ensureWorkspace(), ...list().map((g) => g.path)])

  const guardConfig = (): GuardConfig => ({ roots: roots(), denylist })

  return { workspacePath, ensureWorkspace, list, add, remove, roots, guardConfig, denylist }
}

export type GrantStore = ReturnType<typeof createGrantStore>
