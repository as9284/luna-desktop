import path from 'node:path'
import { guardPath, type GuardConfig } from './fs/paths'
import { needsApproval, describe, classify, type FsAction, type Tier } from './fs/policy'
import type { FsOps } from './fs/ops'
import type { ExtractResult } from './extract'
import type { SandboxResult } from './sandbox'

/**
 * The file/code tool executor, as an injectable core so the whole composition (guard →
 * tiered approval → op) is testable under plain Node (see scripts/test-tools.mts). The
 * Electron wiring in ./index.ts supplies the real deps; tests supply fakes.
 */

export interface PermissionRequest {
  action: FsAction
  target: string
  detail?: string
  signal: AbortSignal
}

export interface FileToolDeps {
  guard: () => GuardConfig
  ops: FsOps
  activity: { push: (e: { action: string; target: string; ok: boolean; detail?: string }) => void }
  extract: (realPath: string) => Promise<ExtractResult>
  /** analyze an image with the vision model, optionally with a specific question */
  analyzeImage: (realPath: string, question?: string) => Promise<{ ok: boolean; text: string; error?: string }>
  runCode: (code: string) => Promise<SandboxResult>
  /** render a self-contained HTML document to PDF bytes (Electron print engine) */
  renderPdf: (html: string) => Promise<Uint8Array>
  /** show a permission card and resolve true/false */
  requestPermission: (req: PermissionRequest) => Promise<boolean>
  /** open the native folder picker and add a grant */
  requestFolderAccess: (reason?: string) => Promise<{ granted: boolean; path?: string; reason?: string }>
  workspaceInfo: () => { workspace: string; grants: { id: string; path: string }[] }
  /** session-scoped "ask once" memory */
  approvedOnce: Set<string>
}

export interface ToolCtx {
  status: (s: string | null) => void
  signal: AbortSignal
}

const clip = (s: string, n = 2000) => (s.length > n ? s.slice(0, n) + '…' : s)

export function createFileTools(deps: FileToolDeps) {
  const run = async (name: string, argsJson: string, ctx: ToolCtx): Promise<string> => {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(argsJson || '{}')
    } catch {
      return JSON.stringify({ error: 'Malformed tool arguments.' })
    }
    const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined)

    switch (name) {
      case 'workspace_info':
        return JSON.stringify(deps.workspaceInfo())

      case 'read_file': {
        const p = str('path')
        if (!p) return JSON.stringify({ error: 'path is required.' })
        const g = guardPath(p, deps.guard())
        if (!g.ok) {
          deps.activity.push({ action: 'read', target: p, ok: false, detail: g.error })
          return JSON.stringify({ error: g.error })
        }
        ctx.status('Reading a file…')
        const ex = await deps.extract(g.real)
        deps.activity.push({ action: 'read', target: g.real, ok: ex.ok, detail: ex.ok ? ex.kind : ex.error })
        ctx.status(null)
        return ex.ok
          ? JSON.stringify({ path: g.real, kind: ex.kind, truncated: ex.truncated, content: ex.text })
          : JSON.stringify({ error: ex.error })
      }

      case 'analyze_image': {
        const p = str('path')
        if (!p) return JSON.stringify({ error: 'path is required.' })
        const g = guardPath(p, deps.guard())
        if (!g.ok) {
          deps.activity.push({ action: 'read', target: p, ok: false, detail: g.error })
          return JSON.stringify({ error: g.error })
        }
        ctx.status('Looking at the image…')
        const v = await deps.analyzeImage(g.real, str('question'))
        deps.activity.push({ action: 'read', target: g.real, ok: v.ok, detail: v.ok ? 'image' : v.error })
        ctx.status(null)
        return v.ok ? JSON.stringify({ path: g.real, kind: 'image', content: v.text }) : JSON.stringify({ error: v.error })
      }

      case 'list_dir': {
        const p = str('path')
        if (!p) return JSON.stringify({ error: 'path is required.' })
        ctx.status('Browsing a folder…')
        const r = await deps.ops.listDir(p)
        ctx.status(null)
        return JSON.stringify(r)
      }

      case 'write_file': {
        const p = str('path')
        if (!p) return JSON.stringify({ error: 'path is required.' })
        const kind = deps.ops.writeKind(p) // create | overwrite | null (guard refused)
        if (kind === null) {
          const g = guardPath(p, deps.guard())
          return JSON.stringify({ error: g.ok ? 'Cannot write there.' : g.error })
        }
        if (needsApproval(kind, 'write', deps.approvedOnce)) {
          const approved = await deps.requestPermission({
            action: kind,
            target: path.basename(p),
            detail: clip(str('content') ?? ''),
            signal: ctx.signal,
          })
          if (!approved) return JSON.stringify({ error: 'The user declined this write.' })
          deps.approvedOnce.add('write') // ask-once → remembered for the session
        }
        const r = await deps.ops.writeFile(p, str('content') ?? '')
        return JSON.stringify(r)
      }

      case 'export_pdf': {
        const p = str('path')
        const html = str('html')
        if (!p) return JSON.stringify({ error: 'path is required.' })
        if (!html) return JSON.stringify({ error: 'html is required.' })
        const kind = deps.ops.writeKind(p) // create | overwrite | null (guard refused)
        if (kind === null) {
          const g = guardPath(p, deps.guard())
          return JSON.stringify({ error: g.ok ? 'Cannot write there.' : g.error })
        }
        if (needsApproval(kind, 'write', deps.approvedOnce)) {
          const approved = await deps.requestPermission({ action: kind, target: path.basename(p), detail: 'PDF document', signal: ctx.signal })
          if (!approved) return JSON.stringify({ error: 'The user declined this export.' })
          deps.approvedOnce.add('write')
        }
        ctx.status('Rendering the PDF…')
        let bytes: Uint8Array
        try {
          bytes = await deps.renderPdf(html)
        } catch (e) {
          ctx.status(null)
          deps.activity.push({ action: 'export_pdf', target: path.basename(p), ok: false, detail: e instanceof Error ? e.message : String(e) })
          return JSON.stringify({ error: `Could not render the PDF: ${e instanceof Error ? e.message : String(e)}` })
        }
        const r = await deps.ops.writeBytes(p, bytes)
        ctx.status(null)
        return JSON.stringify(r)
      }

      case 'delete_file': {
        const p = str('path')
        if (!p) return JSON.stringify({ error: 'path is required.' })
        const g = guardPath(p, deps.guard())
        if (!g.ok) return JSON.stringify({ error: g.error }) // refuse before prompting
        const approved = await deps.requestPermission({ action: 'delete', target: path.basename(p), signal: ctx.signal })
        if (!approved) return JSON.stringify({ error: 'The user declined the deletion.' })
        const r = await deps.ops.deleteFile(p)
        return JSON.stringify(r)
      }

      case 'run_code': {
        const code = str('code')
        if (!code) return JSON.stringify({ error: 'code is required.' })
        const approved = await deps.requestPermission({
          action: 'run_code',
          target: 'a snippet',
          detail: clip(code, 4000),
          signal: ctx.signal,
        })
        if (!approved) return JSON.stringify({ error: 'The user declined to run this code.' })
        ctx.status('Running code…')
        const r = await deps.runCode(code)
        deps.activity.push({ action: 'run_code', target: 'snippet', ok: r.ok, detail: r.ok ? undefined : r.error })
        ctx.status(null)
        return JSON.stringify(r)
      }

      case 'request_folder_access': {
        const res = await deps.requestFolderAccess(str('reason'))
        return JSON.stringify(res)
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  }

  return { run }
}

/* ---------------- tool definitions (OpenAI function-call schema) ---------------- */

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
})

export const LUNA_FS_TOOL_NAMES = new Set([
  'workspace_info',
  'read_file',
  'analyze_image',
  'list_dir',
  'write_file',
  'export_pdf',
  'delete_file',
  'run_code',
  'request_folder_access',
])

export const LUNA_FS_TOOLS = [
  fn(
    'workspace_info',
    "Get Luna's workspace folder and every folder the user has granted access to. Call this before reading or writing files to know which paths are allowed.",
    {},
  ),
  fn(
    'read_file',
    'Read a file and get its text. Handles plain text, code, JSON/CSV, PDF, Word (.docx) and Excel (.xlsx). The path must be inside the workspace or a granted folder.',
    { path: { type: 'string', description: 'Absolute path to the file' } },
    ['path'],
  ),
  fn(
    'analyze_image',
    'Look at an image (PNG, JPG, WEBP, GIF) with the vision model and get a description or answer. Use for screenshots, photos, diagrams, or scanned pages. Pass a question to ask about something specific.',
    { path: { type: 'string' }, question: { type: 'string', description: 'Optional: what to look for' } },
    ['path'],
  ),
  fn(
    'list_dir',
    'List the entries (files and subfolders) of a directory inside the workspace or a granted folder.',
    { path: { type: 'string', description: 'Absolute path to the folder' } },
    ['path'],
  ),
  fn(
    'write_file',
    'Create or overwrite a text file. Overwrites are backed up automatically. Only paths inside the workspace or a granted folder are allowed; the user is asked to approve.',
    { path: { type: 'string' }, content: { type: 'string' } },
    ['path', 'content'],
  ),
  fn(
    'export_pdf',
    'Render a self-contained HTML document to a real .pdf file in the workspace, using the system print engine (so @page and print CSS apply and backgrounds print). Provide the complete HTML with all CSS inlined in a <style> block; use system font stacks and embed images as data: URIs — external fonts and remote URLs will NOT load. Ideal for resumes, reports, invoices, and other polished documents.',
    { path: { type: 'string', description: 'Output .pdf path in the workspace or a granted folder' }, html: { type: 'string', description: 'Complete, self-contained HTML document to render' } },
    ['path', 'html'],
  ),
  fn(
    'delete_file',
    'Move a file to the Recycle Bin (recoverable, never a hard delete). The user must confirm every deletion.',
    { path: { type: 'string' } },
    ['path'],
  ),
  fn(
    'run_code',
    'Run a small JavaScript snippet in a locked-down sandbox (no file, network, or system access) to compute an exact answer, parse data, or transform text. The last expression is the result; use console.log for intermediate output. The user must confirm each run.',
    { code: { type: 'string', description: 'JavaScript to execute' } },
    ['code'],
  ),
  fn(
    'request_folder_access',
    'Ask the user to grant Luna access to a folder (opens a native folder picker). Use when the user refers to files outside the workspace and the folder is not yet granted.',
    { reason: { type: 'string', description: 'Short reason shown to the user' } },
  ),
]

export { classify, describe }
export type { FsAction, Tier }
