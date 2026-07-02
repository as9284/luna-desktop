import { BrowserWindow, ipcMain } from 'electron'
import { resolveLink } from './extract'
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
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

/* ---------------- IPC ---------------- */

export function registerAtlas(getWin: () => BrowserWindow | null) {
  ipcMain.handle('atlas:save-url', (_e, url: string) => saveUrl(url))
  ipcMain.handle('atlas:save-text', (_e, title: string, text: string) => saveText(title, text))
  ipcMain.handle('atlas:digest', async (_e, id: string) => {
    const res = await digestItem(id)
    notifyChanged()
    return res
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
    const ok = deleteItem(id)
    if (ok) notifyChanged()
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
