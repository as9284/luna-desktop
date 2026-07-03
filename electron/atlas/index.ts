import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { resolveLink } from './extract'
import { readForAtlas } from '../luna'
import {
  addHighlight,
  allHighlights,
  deleteHighlight,
  deleteItem,
  facets,
  getItem,
  getItemByUrl,
  insertItem,
  itemHighlights,
  listItems,
  relatedItems,
  updateHighlight,
  updateItem,
  type AtlasFilters,
  type AtlasItem,
  type AtlasStatus,
} from './db'
import { digestItem } from './digest'
import { exportItems } from './export'
import { copyToVault, readVaultBytes, deleteVault, vaultDir } from './vault'
import path from 'node:path'
import fs from 'node:fs'
import { pptxSlides } from '../luna/pptx'

const EXTRACT_TIMEOUT_MS = 45_000
/** Body size sent to the model when Luna reads an article via atlas_get_article. */
const TOOL_BODY_CHARS = 12_000

/** Any mutation pings the renderer so open Atlas views refresh. */
function notifyChanged() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('atlas:changed')
}

function normalizeUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.href
  } catch {
    return null
  }
}

const domainOf = (url: string) => new URL(url).hostname.replace(/^www\./, '')

export interface SaveResult {
  ok: boolean
  item?: AtlasItem
  existed?: boolean
  error?: string
}

/**
 * Detect the link type (tweet, video, reddit thread, PDF, article, …), extract it the
 * right way, and archive it as a typed item. Falls back to a clean stub — never a text
 * dump — when a page can't be read. Dedupes by URL.
 */
export async function saveUrl(rawUrl: string, opts: { shelf?: 'research' | null } = {}, signal?: AbortSignal): Promise<SaveResult> {
  const url = normalizeUrl(rawUrl)
  if (!url) return { ok: false, error: 'That does not look like a valid link.' }

  const existing = getItemByUrl(url)
  if (existing) return { ok: true, item: existing, existed: true }

  const timeout = AbortSignal.timeout(EXTRACT_TIMEOUT_MS)
  const doc = await resolveLink(url, signal ? AbortSignal.any([signal, timeout]) : timeout).catch(() => null)
  if (!doc?.ok || (!doc.body.trim() && !doc.title)) return { ok: false, error: 'Could not read that page.' }

  const item = insertItem({
    kind: 'url',
    mediaType: doc.mediaType,
    url,
    domain: domainOf(url),
    title: doc.title?.trim() || url,
    body: doc.body.trim(),
    content: doc.content?.trim() || null,
    meta: doc.meta,
    excerpt: doc.excerpt,
    shelf: opts.shelf ?? null,
  })
  notifyChanged()
  return { ok: true, item }
}

/**
 * File a local document into Atlas as a re-readable, searchable item that keeps a link back
 * to the original file on disk. Deduped by source path so re-saving updates nothing.
 */
export function saveDocument(d: {
  title: string
  text: string
  sourcePath: string
  mediaType: 'file' | 'image' | 'pdf'
  fileType?: string
  pages?: number
}): SaveResult {
  const body = d.text.trim()
  if (!body) return { ok: false, error: 'Nothing to save from that file.' }
  const existing = listItems().find((i) => i.meta?.sourcePath === d.sourcePath)
  if (existing) return { ok: true, item: getItem(existing.id) ?? existing, existed: true }
  // copy the original into the vault so the viewer can always re-render it, even if the
  // source later moves or is deleted. Falls back to text-only if the copy can't be made.
  const vaultFile = copyToVault(d.sourcePath, d.fileType) ?? undefined
  const item = insertItem({
    kind: 'text',
    mediaType: d.mediaType,
    url: null,
    domain: null,
    title: d.title,
    body,
    content: null,
    meta: { sourcePath: d.sourcePath, fileType: d.fileType, pages: d.pages, vaultFile, siteName: (d.fileType || 'file').toUpperCase() },
    excerpt: body.slice(0, 200),
  })
  notifyChanged()
  return { ok: true, item }
}

export function saveText(title: string, text: string): SaveResult {
  const body = text.trim()
  if (!body) return { ok: false, error: 'Nothing to save.' }
  const firstLine = body.split('\n')[0].trim()
  const item = insertItem({
    kind: 'text',
    url: null,
    domain: null,
    title: title.trim() || firstLine.slice(0, 60) + (firstLine.length > 60 ? '…' : ''),
    body,
    excerpt: body.slice(0, 200),
  })
  notifyChanged()
  return { ok: true, item }
}

/** Silently archive a page Luna already read during web search (opt-in shelf). No AI pass. */
export async function saveResearchDoc(url: string, title: string | null, text: string, markdown?: string): Promise<void> {
  const normalized = normalizeUrl(url)
  if (!normalized || !text.trim() || getItemByUrl(normalized)) return
  insertItem({
    kind: 'url',
    url: normalized,
    domain: domainOf(normalized),
    title: title?.trim() || normalized,
    body: text.trim(),
    content: markdown?.trim() || null,
    excerpt: text.trim().slice(0, 200),
    shelf: 'research',
  })
  notifyChanged()
}

/* ---------------- Luna tools (run directly in the main process) ---------------- */

const lightItem = (i: AtlasItem) => ({
  id: i.id,
  title: i.title,
  url: i.url,
  domain: i.domain,
  tags: i.tags,
  status: i.status,
  saved: new Date(i.savedAt).toISOString().slice(0, 10),
  summary: i.summary ?? i.excerpt ?? null,
})

export async function runAtlasTool(name: string, argsJson: string, signal: AbortSignal): Promise<string> {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(argsJson || '{}')
  } catch {
    return JSON.stringify({ error: 'Malformed tool arguments.' })
  }
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined)

  switch (name) {
    case 'atlas_search': {
      const results = listItems({ query: str('query') ?? '' }).slice(0, 8).map(lightItem)
      return JSON.stringify(results.length ? { results } : { results: [], note: 'Nothing in the library matches.' })
    }
    case 'atlas_get_article': {
      const item = str('id') ? getItem(str('id')!) : null
      if (!item) return JSON.stringify({ error: 'No saved item with that id. Use atlas_search first.' })
      return JSON.stringify({
        ...lightItem(item),
        keyPoints: item.keyPoints,
        body: (item.body ?? '').slice(0, TOOL_BODY_CHARS),
        highlights: itemHighlights(item.id).map((h) => ({ text: h.text, note: h.note || undefined })),
      })
    }
    case 'atlas_save_url': {
      const url = str('url')
      if (!url) return JSON.stringify({ error: 'url is required.' })
      const saved = await saveUrl(url, {}, signal)
      if (!saved.ok || !saved.item) return JSON.stringify({ error: saved.error ?? 'Save failed.' })
      if (!saved.existed && !saved.item.summary) {
        const { item } = await digestItem(saved.item.id, signal)
        notifyChanged()
        return JSON.stringify({ ok: true, saved: lightItem(item) })
      }
      return JSON.stringify({ ok: true, alreadySaved: !!saved.existed, saved: lightItem(saved.item) })
    }
    case 'atlas_list_highlights': {
      const rows = allHighlights(str('query')).slice(0, 50)
      return JSON.stringify({
        highlights: rows.map((h) => ({ text: h.text, note: h.note || undefined, from: h.itemTitle, itemId: h.itemId })),
      })
    }
    case 'atlas_save_text': {
      const text = str('text')
      if (!text) return JSON.stringify({ error: 'text is required.' })
      const saved = saveText(str('title') ?? '', text)
      return saved.ok && saved.item
        ? JSON.stringify({ ok: true, saved: lightItem(saved.item) })
        : JSON.stringify({ error: saved.error ?? 'Save failed.' })
    }
    case 'atlas_save_file': {
      const p = str('path')
      if (!p) return JSON.stringify({ error: 'path is required.' })
      const r = await readForAtlas(p)
      if (!r.ok || !r.text) return JSON.stringify({ error: r.error ?? 'Could not read that file.' })
      const saved = saveDocument({
        title: r.title!, text: r.text, sourcePath: r.realPath!, mediaType: r.mediaType!, fileType: r.fileType, pages: r.pages,
      })
      return saved.ok && saved.item
        ? JSON.stringify({ ok: true, alreadySaved: !!saved.existed, saved: lightItem(saved.item) })
        : JSON.stringify({ error: saved.error ?? 'Save failed.' })
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

/* ---------------- built-in document viewer models ---------------- */

const MAX_ROWS = 400
const MAX_COLS = 60

interface SheetCell {
  v: string
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  color?: string
  bg?: string
  rowSpan?: number
  colSpan?: number
  hidden?: boolean // covered by a merge above/left
}
interface Sheet {
  name: string
  cols: number
  colWidths: number[]
  rows: SheetCell[][]
}

const colNum = (s: string): number => {
  let n = 0
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}
const argbToCss = (argb?: string): string | undefined => {
  if (!argb || typeof argb !== 'string' || argb.length < 6) return undefined
  const hex = argb.length === 8 ? argb.slice(2) : argb
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : undefined
}

/** Parse a vaulted .xlsx into a compact, styled grid model for the sheet viewer. */
async function sheetModel(real: string): Promise<{ kind: 'sheet'; sheets: Sheet[]; truncated: boolean }> {
  const mod = (await import('exceljs')) as unknown as { default?: unknown; Workbook?: unknown }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (mod.default ?? mod) as any
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(real)
  let truncated = false
  const sheets: Sheet[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wb.worksheets.forEach((sheet: any) => {
    const rowCount = Math.min(sheet.rowCount || 0, MAX_ROWS)
    const colCount = Math.min(sheet.columnCount || 0, MAX_COLS)
    if (sheet.rowCount > MAX_ROWS || sheet.columnCount > MAX_COLS) truncated = true

    // merges: exceljs exposes them as "A1:C2" range strings
    const merges: string[] = Array.isArray(sheet.model?.merges) ? sheet.model.merges : []
    const covered = new Set<string>()
    const spanAt = new Map<string, { rs: number; cs: number }>()
    for (const range of merges) {
      const m = /([A-Z]+)(\d+):([A-Z]+)(\d+)/.exec(range)
      if (!m) continue
      const [r1, c1, r2, c2] = [Number(m[2]), colNum(m[1]), Number(m[4]), colNum(m[3])]
      spanAt.set(`${r1}:${c1}`, { rs: r2 - r1 + 1, cs: c2 - c1 + 1 })
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) if (!(r === r1 && c === c1)) covered.add(`${r}:${c}`)
    }

    const colWidths: number[] = []
    for (let c = 1; c <= colCount; c++) {
      const w = sheet.getColumn(c)?.width
      colWidths.push(typeof w === 'number' ? Math.round(w * 7) : 84) // exceljs width ≈ chars → px
    }

    const rows: SheetCell[][] = []
    for (let r = 1; r <= rowCount; r++) {
      const row = sheet.getRow(r)
      const cells: SheetCell[] = []
      for (let c = 1; c <= colCount; c++) {
        if (covered.has(`${r}:${c}`)) {
          cells.push({ v: '', hidden: true })
          continue
        }
        const cell = row.getCell(c)
        const style = cell.style || {}
        const align = style.alignment?.horizontal
        const span = spanAt.get(`${r}:${c}`)
        cells.push({
          v: String(cell.text ?? ''),
          bold: style.font?.bold || undefined,
          italic: style.font?.italic || undefined,
          align: align === 'center' || align === 'right' || align === 'left' ? align : undefined,
          color: argbToCss(style.font?.color?.argb),
          bg: style.fill?.type === 'pattern' ? argbToCss(style.fill.fgColor?.argb) : undefined,
          rowSpan: span && span.rs > 1 ? span.rs : undefined,
          colSpan: span && span.cs > 1 ? span.cs : undefined,
        })
      }
      rows.push(cells)
    }
    sheets.push({ name: sheet.name, cols: colCount, colWidths, rows })
  })
  return { kind: 'sheet', sheets, truncated }
}

/* ---------------- IPC ---------------- */

export function registerAtlas(getWin: () => BrowserWindow | null) {
  ipcMain.handle('atlas:save-url', (_e, url: string) => saveUrl(url))
  ipcMain.handle('atlas:save-text', (_e, title: string, text: string) => saveText(title, text))
  ipcMain.handle('atlas:save-file', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, { title: 'Add documents to Atlas', properties: ['openFile', 'multiSelections'] })
    if (res.canceled) return []
    const out: { ok: boolean; item?: AtlasItem; name?: string; error?: string }[] = []
    for (const p of res.filePaths.slice(0, 20)) {
      const r = await readForAtlas(p, { picked: true })
      if (!r.ok || !r.text) {
        out.push({ ok: false, name: p.split(/[\\/]/).pop(), error: r.error })
        continue
      }
      const saved = saveDocument({
        title: r.title!, text: r.text, sourcePath: r.realPath!, mediaType: r.mediaType!, fileType: r.fileType, pages: r.pages,
      })
      out.push(saved.ok && saved.item ? { ok: true, item: saved.item } : { ok: false, name: r.title, error: saved.error })
    }
    return out
  })
  ipcMain.handle('atlas:digest', async (_e, id: string) => {
    const res = await digestItem(id)
    notifyChanged()
    return res
  })

  // Built-in document viewer: raw bytes of a vaulted file (pdf/docx/image render client-side).
  ipcMain.handle('atlas:file-bytes', (_e, id: string) => {
    const item = getItem(id)
    if (!item) return { ok: false, error: 'Item not found.' }
    const v = readVaultBytes(item)
    if (!v) return { ok: false, error: 'No stored copy of this file.' }
    return { ok: true, bytes: v.bytes, mime: v.mime, name: v.name, fileType: item.meta?.fileType }
  })

  // Open a vaulted document in the OS default app (from there the user can print / save-as).
  ipcMain.handle('atlas:open-file', (_e, id: string) => {
    const item = getItem(id, false)
    const file = item?.meta?.vaultFile
    if (!file) return { ok: false, error: 'No stored copy of this file.' }
    void shell.openPath(path.join(vaultDir(), path.basename(file)))
    return { ok: true }
  })

  // Built-in document viewer: a parsed render model for spreadsheets (grid) and decks (slides).
  ipcMain.handle('atlas:doc-model', async (_e, id: string) => {
    const item = getItem(id)
    if (!item) return { ok: false, error: 'Item not found.' }
    const file = item.meta?.vaultFile
    if (!file) return { ok: false, error: 'No stored copy of this file.' }
    const real = path.join(vaultDir(), path.basename(file))
    const ft = (item.meta?.fileType || '').toLowerCase()
    try {
      if (ft === 'xlsx' || ft === 'xlsm') return { ok: true, model: await sheetModel(real) }
      if (ft === 'pptx') return { ok: true, model: { kind: 'slides', slides: await pptxSlides(fs.readFileSync(real)) } }
      return { ok: false, error: 'No render model for this file type.' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('atlas:list', (_e, filters: AtlasFilters) => listItems(filters ?? {}))
  ipcMain.handle('atlas:get', (_e, id: string) => {
    const item = getItem(id)
    return item ? { item, highlights: itemHighlights(id) } : null
  })
  ipcMain.handle(
    'atlas:update',
    (_e, id: string, patch: { title?: string; status?: AtlasStatus; queuedAt?: number | null; scroll?: number; tags?: string[] }) => {
      // whitelist — digest fields and shelf are owned by the main process
      const safe: Parameters<typeof updateItem>[1] = {}
      if (typeof patch.title === 'string' && patch.title.trim()) safe.title = patch.title.trim()
      if (patch.status === 'unread' || patch.status === 'reading' || patch.status === 'done') safe.status = patch.status
      if ('queuedAt' in patch && (patch.queuedAt === null || typeof patch.queuedAt === 'number')) safe.queuedAt = patch.queuedAt
      if (typeof patch.scroll === 'number') safe.scroll = Math.max(0, Math.min(1, patch.scroll))
      if (Array.isArray(patch.tags)) safe.tags = patch.tags.filter((t): t is string => typeof t === 'string')
      const item = updateItem(id, safe)
      // scroll position updates fire constantly while reading — not worth a refresh ping
      if (Object.keys(safe).some((k) => k !== 'scroll')) notifyChanged()
      return item
    },
  )
  ipcMain.handle('atlas:delete', (_e, id: string) => {
    const item = getItem(id, false)
    const ok = deleteItem(id)
    if (ok) {
      deleteVault(item) // remove the vaulted copy too — it's ours to clean up
      notifyChanged()
    }
    return ok
  })

  ipcMain.handle('atlas:highlight-add', (_e, itemId: string, text: string, note?: string) => {
    const h = addHighlight(itemId, text, note ?? '')
    if (h) notifyChanged()
    return h
  })
  ipcMain.handle('atlas:highlight-note', (_e, id: string, note: string) => updateHighlight(id, note))
  ipcMain.handle('atlas:highlight-delete', (_e, id: string) => {
    const ok = deleteHighlight(id)
    if (ok) notifyChanged()
    return ok
  })
  ipcMain.handle('atlas:highlights', (_e, query?: string) => allHighlights(query))

  ipcMain.handle('atlas:related', (_e, id: string) => relatedItems(id))
  ipcMain.handle('atlas:facets', () => facets())
  ipcMain.handle('atlas:export', (_e, ids: string[]) => exportItems(getWin(), Array.isArray(ids) ? ids : []))
}
