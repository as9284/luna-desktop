/**
 * Luna's processing feedback: a stream of typed "steps" the renderer turns into the live activity
 * trace (while she works) and the compact saved record on the finished message. This module is the
 * pure, Electron-free core — the tool loop builds a step from a call with `stepFor`, and classifies
 * the result with `outcomeOf`. Unit-tested in scripts/test-activity.mts.
 */

/** The kind of work a step represents — drives which animated glyph the renderer shows. */
export type ActivityKind =
  | 'search' | 'web' | 'read' | 'browse' | 'image' | 'write' | 'pdf' | 'code'
  | 'delete' | 'save' | 'highlight' | 'task' | 'note' | 'project'
  | 'skill' | 'memory' | 'think'

/** Lifecycle of a step. `awaiting` = blocked on the user (a permission prompt). */
export type StepState = 'running' | 'done' | 'error' | 'awaiting'

export interface LunaStep {
  /** stable per step instance — later events with the same id update the same row */
  id: string
  kind: ActivityKind
  state: StepState
  /** the action, e.g. "Reading" */
  label: string
  /** the specific object, shown emphasized, e.g. "notes.pdf" or "\"eu heatwave\"" */
  target?: string
  /** the live sub-phase ("extracting…") or, on error, a plain reason */
  detail?: string
}

export interface StepSeed { kind: ActivityKind; label: string; target?: string }

const basename = (p: string): string => p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p
const host = (u: string): string => {
  try { return new URL(u).host } catch { return u }
}
const clip = (s: string, n = 56): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
const quote = (s?: string): string | undefined => (s ? `“${clip(s)}”` : undefined)

/**
 * Map a tool call (name + parsed args) to the activity it represents — the kind (glyph), the
 * action label, and the specific target. Pure; every tool Luna can call is covered, with a
 * readable fallback for anything unrecognized.
 */
export function stepFor(name: string, args: Record<string, unknown>): StepSeed {
  const s = (k: string) => (typeof args[k] === 'string' ? (args[k] as string).trim() : undefined)
  const file = (k: string) => { const v = s(k); return v ? basename(v) : undefined }
  switch (name) {
    case 'web_search': return { kind: 'search', label: 'Searching the web', target: quote(s('query')) }
    case 'atlas_search': return { kind: 'search', label: 'Searching Atlas', target: quote(s('query')) }
    case 'atlas_get_article': return { kind: 'read', label: 'Opening an article' }
    case 'atlas_save_url': return { kind: 'save', label: 'Saving to Atlas', target: s('url') ? host(s('url')!) : undefined }
    case 'atlas_save_text': return { kind: 'save', label: 'Saving a note to Atlas', target: s('title') ? clip(s('title')!) : undefined }
    case 'atlas_save_file': return { kind: 'save', label: 'Filing in Atlas', target: file('path') }
    case 'atlas_list_highlights': return { kind: 'highlight', label: 'Gathering highlights', target: quote(s('query')) }
    case 'orbit_list': return { kind: 'read', label: 'Reading Orbit' }
    case 'orbit_add_task': return { kind: 'task', label: 'Adding a task', target: s('text') ? clip(s('text')!) : undefined }
    case 'orbit_set_task_done': return { kind: 'task', label: 'Updating a task' }
    case 'orbit_remove_task': return { kind: 'task', label: 'Removing a task' }
    case 'orbit_clear_done_tasks': return { kind: 'task', label: 'Clearing finished tasks' }
    case 'orbit_add_note': return { kind: 'note', label: 'Adding a note', target: s('title') ? clip(s('title')!) : undefined }
    case 'orbit_update_note': return { kind: 'note', label: 'Updating a note' }
    case 'orbit_remove_note': return { kind: 'note', label: 'Removing a note' }
    case 'orbit_add_project': return { kind: 'project', label: 'Creating a project', target: s('name') ? clip(s('name')!) : undefined }
    case 'orbit_update_project': return { kind: 'project', label: 'Updating a project' }
    case 'orbit_remove_project': return { kind: 'project', label: 'Removing a project' }
    case 'read_file': return { kind: 'read', label: 'Reading', target: file('path') }
    case 'write_file': return { kind: 'write', label: 'Writing', target: file('path') }
    case 'export_pdf': return { kind: 'pdf', label: 'Exporting PDF', target: file('path') }
    case 'run_code': return { kind: 'code', label: 'Running code' }
    case 'delete_file': return { kind: 'delete', label: 'Deleting', target: file('path') }
    case 'list_dir': return { kind: 'browse', label: 'Browsing', target: file('path') }
    case 'analyze_image': return { kind: 'image', label: 'Looking at', target: file('path') }
    case 'request_folder_access': return { kind: 'browse', label: 'Requesting folder access' }
    case 'workspace_info': return { kind: 'read', label: 'Checking the workspace' }
    case 'use_skill': return { kind: 'skill', label: 'Using a skill', target: s('name') ? clip(s('name')!) : undefined }
    case 'remember': return { kind: 'memory', label: 'Remembering', target: s('note') ? clip(s('note')!, 44) : undefined }
    default: return { kind: 'read', label: name.replace(/_/g, ' ') }
  }
}

/**
 * Decide whether a tool result is a success or a failure, with a short human reason on failure.
 * web_search returns markdown on success and a plain sentence on failure; every other tool returns
 * JSON with an `error` string or `ok:false` when it fails.
 */
export function outcomeOf(name: string, result: string): { ok: boolean; detail?: string } {
  const trimmed = (result || '').trim()
  if (name === 'web_search') {
    if (/^search failed/i.test(trimmed) || /^no query provided/i.test(trimmed)) return { ok: false, detail: clip(trimmed, 80) }
    return { ok: true }
  }
  try {
    const r = JSON.parse(trimmed) as Record<string, unknown>
    if (r && typeof r === 'object') {
      if (r.error) return { ok: false, detail: clip(String(r.error), 80) }
      if (r.ok === false) return { ok: false, detail: r.reason ? clip(String(r.reason), 80) : undefined }
    }
    return { ok: true }
  } catch {
    return { ok: true } // a non-JSON, non-web_search result is content, i.e. success
  }
}
