/**
 * Tiered-by-risk permission policy (the dial the user chose):
 *  - read / list / stat  → silent (no prompt) inside a granted root
 *  - create / overwrite  → silent inside Luna's own workspace (her sandbox; overwrites are
 *                          backed up so they stay recoverable); ask-once in a granted folder
 *  - delete / run code    → always confirm, every time, everywhere
 *
 * classify() is pure. The "ask once, remembered" memory is a per-session Set the caller
 * owns, so it resets every launch — a fresh session always re-confirms writes at least once.
 */

export type FsAction =
  | 'read'
  | 'list'
  | 'stat'
  | 'create' // write to a path that does not exist yet
  | 'overwrite' // write over an existing file
  | 'delete'
  | 'run_code'
  | 'grant' // user is granting a new folder — always explicit

export type Tier = 'silent' | 'ask-once' | 'confirm'

export function classify(action: FsAction): Tier {
  switch (action) {
    case 'read':
    case 'list':
    case 'stat':
      return 'silent'
    case 'create':
    case 'overwrite':
      return 'ask-once'
    case 'delete':
    case 'run_code':
    case 'grant':
      return 'confirm'
  }
}

/** A short, human phrase for the permission card in the conversation. */
export function describe(action: FsAction, target: string): string {
  switch (action) {
    case 'create':
      return `Create ${target}`
    case 'overwrite':
      return `Overwrite ${target}`
    case 'delete':
      return `Move ${target} to the Recycle Bin`
    case 'run_code':
      return `Run code`
    case 'grant':
      return `Give Luna access to ${target}`
    default:
      return `${action} ${target}`
  }
}

/**
 * Decide whether an action needs the user, given what's already been approved this session and
 * whether the target sits inside Luna's own workspace. `approvedOnce` holds keys (e.g. an
 * action:target string) the user OK'd earlier. A create/overwrite inside the workspace is
 * auto-approved; delete/run_code always confirm regardless of location.
 */
export function needsApproval(action: FsAction, key: string, approvedOnce: ReadonlySet<string>, inWorkspace = false): boolean {
  const tier = classify(action)
  if (tier === 'silent') return false
  if (tier === 'confirm') return true
  if (inWorkspace) return false // ask-once tier is auto-approved in Luna's sandbox
  return !approvedOnce.has(key) // ask-once elsewhere
}
