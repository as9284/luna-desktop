import { app, dialog, ipcMain, shell, BrowserWindow, nativeImage, type IpcMainEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createGrantStore, type GrantStore } from './fs/grants'
import { createFsOps, type FsOps } from './fs/ops'
import { createActivityLog, type ActivityLog } from './fs/log'
import { classify, describe, type FsAction } from './fs/policy'
import { guardPath, realOf } from './fs/paths'
import { extractDocument, type ExtractResult } from './extract'
import { runSandboxed } from './sandbox'
import { describeImage, isImageExt } from '../llm'
import { createFileTools, LUNA_FS_TOOLS, LUNA_FS_TOOL_NAMES } from './tools'

/**
 * Luna's filesystem + code capabilities, assembled with real Electron services. The
 * security-critical logic (path guard, ops, extraction, sandbox, tool composition) lives in
 * ./fs, ./extract, ./sandbox and ./tools and is unit-tested under plain Node. This module is
 * the thin, Electron-flavored seam: the live singletons, the permission round-trip to the
 * renderer (inline permission cards), the native folder picker, and drawer IPC.
 */

export { LUNA_FS_TOOLS, LUNA_FS_TOOL_NAMES }

let store: GrantStore | null = null
let ops: FsOps | null = null
let activity: ActivityLog | null = null
let tools: ReturnType<typeof createFileTools> | null = null
/** "ask-once" approvals remembered for this session only (resets each launch). */
const approvedOnce = new Set<string>()

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

function workspaceInfo(): { workspace: string; grants: { id: string; path: string }[] } {
  init()
  return { workspace: store!.ensureWorkspace(), grants: store!.list().map((g) => ({ id: g.id, path: g.path })) }
}

/** Absolute path of the Luna workspace (e.g. for the soul/System dir). */
export function lunaWorkspace(): string {
  init()
  return store!.ensureWorkspace()
}

/** Ask the renderer to show an inline permission card and wait for the user's decision. */
function requestPermission(
  event: IpcMainEvent,
  req: { action: FsAction; target: string; detail?: string; signal: AbortSignal },
): Promise<boolean> {
  return new Promise((resolve) => {
    const id = (globalThis.crypto?.randomUUID?.() ?? String(Date.now())) as string
    const ch = `luna:permission-response:${id}`
    let settled = false
    const done = (approved: boolean) => {
      if (settled) return
      settled = true
      ipcMain.removeAllListeners(ch)
      resolve(approved)
    }
    ipcMain.once(ch, (_e, res: { approved?: boolean }) => done(!!res?.approved))
    req.signal.addEventListener('abort', () => done(false), { once: true }) // cancelled thread → declined
    event.sender.send('luna:permission-request', {
      id,
      action: req.action,
      label: describe(req.action, req.target),
      target: req.target,
      detail: req.detail,
      tier: classify(req.action),
    })
  })
}

async function pickFolder(win: BrowserWindow | undefined, title: string) {
  const res = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory'], buttonLabel: 'Grant access' })
  if (res.canceled || !res.filePaths[0]) return { ok: false as const }
  const added = store!.add(res.filePaths[0])
  if (added.ok) {
    broadcast('luna:fs-grants-changed', null)
    activity!.push({ action: 'grant', target: added.grant.path, ok: true })
  }
  return added.ok ? { ok: true as const, grant: added.grant } : { ok: false as const, error: added.error }
}

function init() {
  if (store) return
  const dirs = { home: app.getPath('home'), userData: app.getPath('userData'), documents: app.getPath('documents') }
  store = createGrantStore(dirs)
  activity = createActivityLog({
    file: path.join(dirs.userData, 'luna-activity.json'),
    emit: (entry) => broadcast('luna:fs-activity', entry),
  })
  ops = createFsOps({
    getGuard: () => store!.guardConfig(),
    trash: (p) => shell.trashItem(p),
    backupDir: path.join(dirs.userData, 'luna-backups'),
    log: (e) => activity!.push(e),
  })
}

/**
 * Render a self-contained HTML document to PDF bytes with an offscreen window and the
 * system print engine. External resources won't resolve (data-URL origin), so the HTML must
 * inline its CSS and embed assets — which is exactly what the design skill produces.
 */
async function htmlToPdf(html: string): Promise<Uint8Array> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // best-effort wait for web fonts/layout to settle before capturing
    await win.webContents.executeJavaScript('document.fonts && document.fonts.ready').catch(() => {})
    const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
    return new Uint8Array(pdf)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export interface Attachment {
  name: string
  /** absolute path for a disk file; absent for pasted clipboard data */
  path?: string
  kind?: string
  text?: string
  truncated?: boolean
  error?: string
  /** self-contained downscaled JPEG data-URL for images — powers the thumbnail + viewer */
  preview?: string
}

/** A small, self-contained JPEG preview of an image (for the chat thumbnail + lightbox). */
const PREVIEW_MAX_W = 1100
function toPreview(img: Electron.NativeImage): string | undefined {
  try {
    if (img.isEmpty()) return undefined
    const scaled = img.getSize().width > PREVIEW_MAX_W ? img.resize({ width: PREVIEW_MAX_W }) : img
    const jpeg = scaled.toJPEG(78)
    return jpeg.length ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : undefined
  } catch {
    return undefined
  }
}

/** Read a file to text — routing images to the vision model, everything else to extraction. */
async function extractOrSee(real: string): Promise<ExtractResult> {
  const ext = real.slice(real.lastIndexOf('.')).toLowerCase()
  if (isImageExt(ext)) {
    const v = await describeImage(real)
    return v.ok ? { ok: true, kind: 'image', text: v.text } : { ok: false, kind: 'image', text: '', error: v.error }
  }
  return extractDocument(real)
}

/**
 * Read a file the user explicitly attached (via picker or drag-drop). Explicit selection is
 * consent, so folder-containment is waived — but the denylist, secret-filename, and size
 * guards still apply, so an attached .env or key file is still refused.
 */
async function readAttachment(p: string): Promise<Attachment> {
  init()
  const real = realOf(p)
  const g = guardPath(real, { roots: [path.dirname(real)], denylist: store!.guardConfig().denylist })
  if (!g.ok) {
    activity!.push({ action: 'attach', target: p, ok: false, detail: g.error })
    return { name: path.basename(p), path: p, error: g.error }
  }
  const ex = await extractOrSee(g.real)
  activity!.push({ action: 'attach', target: g.real, ok: ex.ok, detail: ex.ok ? ex.kind : ex.error })
  const preview = ex.ok && ex.kind === 'image' ? toPreview(nativeImage.createFromPath(g.real)) : undefined
  return ex.ok
    ? { name: path.basename(g.real), path: g.real, kind: ex.kind, text: ex.text, truncated: ex.truncated, ...(preview ? { preview } : {}) }
    : { name: path.basename(p), path: p, error: ex.error }
}

/**
 * Attach raw bytes pasted from the clipboard (an image with no file on disk). We write it to a
 * temp file so the existing extract/vision path can read it, build a thumbnail from the bytes,
 * then clean up. The image still shows even when vision is unavailable — only the description is
 * lost.
 */
async function attachData(name: string, data: Uint8Array, mime?: string): Promise<Attachment> {
  init()
  const buf = Buffer.from(data)
  const preview = toPreview(nativeImage.createFromBuffer(buf))
  const ext = (mime?.split('/')[1] || path.extname(name).replace('.', '') || 'png').toLowerCase()
  const safe = path.basename(name).replace(/[^\w.\-]+/g, '_') || `pasted.${ext}`
  const named = path.extname(safe) ? safe : `${safe}.${ext}`
  const dir = path.join(app.getPath('temp'), 'luna-attachments')
  const tmp = path.join(dir, `${crypto.randomUUID()}-${named}`)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, buf)
    const ex = await extractOrSee(tmp)
    activity!.push({ action: 'attach', target: named, ok: ex.ok, detail: ex.ok ? `${ex.kind} (pasted)` : ex.error })
    return ex.ok
      ? { name: named, kind: ex.kind, text: ex.text, truncated: ex.truncated, ...(preview ? { preview } : {}) }
      : { name: named, error: ex.error, ...(preview ? { preview } : {}) }
  } catch (e) {
    return { name: named, error: e instanceof Error ? e.message : String(e), ...(preview ? { preview } : {}) }
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* best-effort cleanup */ }
  }
}

export interface AtlasReadResult {
  ok: boolean
  realPath?: string
  title?: string
  text?: string
  mediaType?: 'file' | 'image' | 'pdf'
  fileType?: string
  pages?: number
  error?: string
}

/**
 * Read a file so it can be filed into Atlas. Luna's atlas_save_file (picked=false) is scoped
 * to the workspace/granted folders; a user-initiated import (picked=true) waives folder
 * containment — the picker is consent — but keeps the denylist / secret / size guards.
 */
export async function readForAtlas(inputPath: string, opts: { picked?: boolean } = {}): Promise<AtlasReadResult> {
  init()
  const real = realOf(inputPath)
  const guard = opts.picked
    ? guardPath(real, { roots: [path.dirname(real)], denylist: store!.guardConfig().denylist })
    : guardPath(inputPath, store!.guardConfig())
  if (!guard.ok) return { ok: false, error: guard.error }
  const ex = await extractOrSee(guard.real)
  if (!ex.ok) return { ok: false, error: ex.error }
  const ext = path.extname(guard.real).replace(/^\./, '').toLowerCase()
  const mediaType = ex.kind === 'image' ? 'image' : ex.kind === 'pdf' ? 'pdf' : 'file'
  activity!.push({ action: 'read', target: guard.real, ok: true, detail: `atlas:${ex.kind}` })
  return {
    ok: true,
    realPath: guard.real,
    title: path.basename(guard.real),
    text: ex.text,
    mediaType,
    fileType: ext || ex.kind,
    pages:
      typeof ex.meta?.pages === 'number'
        ? (ex.meta.pages as number)
        : typeof ex.meta?.slides === 'number'
          ? (ex.meta.slides as number)
          : undefined,
  }
}

/* ---------------- in-app preview of a file Luna made ---------------- */

const PREVIEW_MAX_BYTES = 30 * 1024 * 1024
const PREVIEW_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml',
}
export type PreviewKind = 'pdf' | 'image' | 'text'

export interface PreviewResult {
  ok: boolean
  bytes?: Uint8Array
  mime?: string
  name?: string
  kind?: PreviewKind
  error?: string
}

/** Read a workspace/granted file's raw bytes so the renderer can preview it (pdf.js, <img>, <pre>). */
async function readOutput(input: string): Promise<PreviewResult> {
  init()
  if (!input) return { ok: false, error: 'No path.' }
  const g = guardPath(input, store!.guardConfig())
  if (!g.ok) return { ok: false, error: g.error }
  try {
    const st = fs.statSync(g.real)
    if (st.isDirectory()) return { ok: false, error: 'That path is a folder.' }
    if (st.size > PREVIEW_MAX_BYTES) return { ok: false, error: 'File is too large to preview.' }
    const ext = path.extname(g.real).replace(/^\./, '').toLowerCase()
    const kind: PreviewKind = ext === 'pdf' ? 'pdf' : isImageExt(`.${ext}`) ? 'image' : 'text'
    const bytes = new Uint8Array(fs.readFileSync(g.real))
    return { ok: true, bytes, mime: PREVIEW_MIME[ext] ?? 'application/octet-stream', name: path.basename(g.real), kind }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Build the tool executor bound to a specific in-flight chat request (its event + signal). */
export async function runLunaFsTool(
  name: string,
  argsJson: string,
  ctx: { event: IpcMainEvent; signal: AbortSignal; statusCh: string },
): Promise<string> {
  init()
  const { event, signal, statusCh } = ctx
  // one executor instance per request so requestPermission/folder-picker bind to this window
  tools = createFileTools({
    guard: () => store!.guardConfig(),
    ops: ops!,
    activity: activity!,
    extract: extractOrSee,
    analyzeImage: (real, question) => describeImage(real, question),
    runCode: (code) => runSandboxed(code, {}),
    renderPdf: htmlToPdf,
    requestPermission: (req) => requestPermission(event, req),
    requestFolderAccess: async (reason) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const r = await pickFolder(win, reason || 'Grant Luna access to a folder')
      return r.ok ? { granted: true, path: r.grant.path } : { granted: false, reason: (r as { error?: string }).error ?? 'The user cancelled.' }
    },
    workspaceInfo,
    approvedOnce,
  })
  return tools.run(name, argsJson, { status: (s) => event.sender.send(statusCh, s), signal })
}

/* ---------------- renderer-facing IPC (edge drawer) ---------------- */

export function registerLunaFs() {
  ipcMain.handle('luna:fs-workspace', () => workspaceInfo())
  ipcMain.handle('luna:fs-activity', (_e, limit?: number) => {
    init()
    return activity!.recent(typeof limit === 'number' ? limit : 100)
  })
  ipcMain.handle('luna:fs-grants', () => {
    init()
    return store!.list().map((g) => ({ id: g.id, path: g.path, addedAt: g.addedAt }))
  })
  ipcMain.handle('luna:fs-revoke', (_e, id: string) => {
    init()
    const ok = store!.remove(id)
    if (ok) broadcast('luna:fs-grants-changed', null)
    return ok
  })
  ipcMain.handle('luna:fs-grant-folder', async (e) => {
    init()
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = await pickFolder(win, 'Grant Luna access to a folder')
    return r.ok ? { ok: true, grant: { id: r.grant.id, path: r.grant.path } } : { ok: false, error: (r as { error?: string }).error }
  })
  ipcMain.handle('luna:fs-attach', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, { title: 'Attach files for Luna', properties: ['openFile', 'multiSelections'] })
    if (res.canceled) return []
    return Promise.all(res.filePaths.slice(0, 20).map(readAttachment))
  })
  ipcMain.handle('luna:fs-attach-paths', async (_e, paths: string[]) => {
    if (!Array.isArray(paths)) return []
    return Promise.all(paths.filter((p) => typeof p === 'string').slice(0, 20).map(readAttachment))
  })
  ipcMain.handle('luna:fs-attach-data', (_e, name: unknown, data: unknown, mime: unknown) => {
    if (!ArrayBuffer.isView(data as ArrayBufferView) && !(data instanceof ArrayBuffer)) {
      return { name: 'pasted', error: 'No image data.' }
    }
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength)
    return attachData(String(name || 'pasted'), bytes, typeof mime === 'string' ? mime : undefined)
  })
  ipcMain.handle('luna:fs-reveal', (_e, p: string) => {
    if (typeof p === 'string' && p) shell.showItemInFolder(p)
    return true
  })
  ipcMain.handle('luna:fs-read-output', (_e, p: unknown) => readOutput(typeof p === 'string' ? p : ''))
  ipcMain.handle('luna:fs-open-workspace', () => {
    init()
    shell.openPath(store!.ensureWorkspace())
    return true
  })
}
