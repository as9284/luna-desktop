import fs from 'node:fs'
import path from 'node:path'

/**
 * The path guard — the one gate every filesystem operation passes through.
 *
 * Guarantees (see the test harness in scripts/test-fs.mts):
 *  - a path may only resolve *inside* a granted root (the Luna workspace or a folder the
 *    user explicitly granted). Anything outside is refused.
 *  - a hard denylist (system dirs, credential stores, Luna's own key storage) always wins,
 *    even if it sits inside a granted root. Grants can never re-open a denied path.
 *  - symlinks can't tunnel out: the existing portion of a path is realpath-resolved before
 *    the containment check, so a link pointing outside a root is caught.
 *  - secret-looking filenames (.env, id_rsa, *.pem, …) are refused regardless of location.
 */

/** win32 is case-insensitive; normalize so containment checks aren't fooled by casing. */
const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)

/** Is `child` the same as, or nested under, `parent`? */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(norm(parent), norm(child))
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
}

/**
 * Resolve the *real* absolute location of a path, following symlinks on the part that
 * actually exists, then re-appending the not-yet-created tail (so writes to new files
 * still get symlink-safe containment). Never throws.
 */
export function realOf(input: string): string {
  let cur = path.resolve(input)
  const tail: string[] = []
  // walk up to the deepest ancestor that exists on disk
  for (let i = 0; i < 4096 && !fs.existsSync(cur); i++) {
    tail.unshift(path.basename(cur))
    const parent = path.dirname(cur)
    if (parent === cur) break // hit the filesystem root
    cur = parent
  }
  let realBase: string
  try {
    realBase = fs.realpathSync.native(cur)
  } catch {
    realBase = cur
  }
  return tail.length ? path.join(realBase, ...tail) : realBase
}

/** Filenames that are almost never "documents" and often hold secrets. */
const SECRET_NAMES = /^(\.env(\..+)?|id_rsa|id_dsa|id_ecdsa|id_ed25519|\.netrc|\.pgpass|.*\.(pem|key|pfx|p12|keychain|ppk))$/i

export interface GuardConfig {
  /** absolute, realpath-resolved roots Luna may operate inside */
  roots: string[]
  /** absolute, realpath-resolved paths that are always off-limits */
  denylist: string[]
}

export type GuardResult = { ok: true; real: string } | { ok: false; error: string }

/**
 * The gate. Give it whatever path Luna asked for; get back either the resolved real path
 * (safe to use) or a refusal with a human-readable reason.
 */
export function guardPath(input: string, cfg: GuardConfig): GuardResult {
  if (!input || typeof input !== 'string') return { ok: false, error: 'No path provided.' }

  const real = realOf(input)

  // denylist beats everything, including an explicit grant
  for (const denied of cfg.denylist) {
    if (isInside(denied, real)) {
      return { ok: false, error: `Refused: "${input}" is inside a protected location Luna can never access.` }
    }
  }

  // must live inside at least one granted root
  const inRoot = cfg.roots.some((r) => isInside(r, real))
  if (!inRoot) {
    return {
      ok: false,
      error: `Refused: "${input}" is outside Luna's workspace and every folder you've granted. Grant that folder first.`,
    }
  }

  if (SECRET_NAMES.test(path.basename(real))) {
    return { ok: false, error: `Refused: "${path.basename(real)}" looks like a secret/key file — Luna won't touch it.` }
  }

  return { ok: true, real }
}

/** Realpath-resolve a list of roots/denylist entries, dropping ones that don't resolve. */
export function normalizeRoots(dirs: string[]): string[] {
  const out: string[] = []
  for (const d of dirs) {
    if (!d) continue
    try {
      out.push(fs.existsSync(d) ? fs.realpathSync.native(d) : path.resolve(d))
    } catch {
      out.push(path.resolve(d))
    }
  }
  return out
}
