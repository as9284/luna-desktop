import { app } from 'electron'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { AtlasMeta, MediaType } from './extract/types'

export type AtlasStatus = 'unread' | 'reading' | 'done'

export interface AtlasItem {
  id: string
  kind: 'url' | 'text'
  /** what the link *is* — drives the type badge + reader chrome */
  mediaType: MediaType
  url: string | null
  domain: string | null
  title: string
  excerpt: string | null
  summary: string | null
  keyPoints: string[]
  quotes: string[]
  tags: string[]
  status: AtlasStatus
  queuedAt: number | null
  shelf: 'research' | null
  wordCount: number
  savedAt: number
  scroll: number
  /** present only on atlas:get / tool reads — list rows stay light */
  body?: string
  /** structured markdown (paragraphs, images, formatting) for the reader; body stays plain */
  content?: string
  /** typed chrome (author, avatar, hero image, …) for social/video/stub items */
  meta?: AtlasMeta | null
}

export interface AtlasHighlight {
  id: string
  itemId: string
  text: string
  note: string
  createdAt: number
  /** joined in for the global browser */
  itemTitle?: string
}

export interface AtlasFilters {
  query?: string
  status?: AtlasStatus | 'queued'
  tag?: string
  domain?: string
  /** 'research' = only the auto-saved research shelf; 'none' = exclude it; undefined = everything */
  shelf?: 'research' | 'none'
}

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(path.join(app.getPath('userData'), 'atlas.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'article',
      url TEXT,
      domain TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      content TEXT,
      meta TEXT,
      excerpt TEXT,
      summary TEXT,
      key_points TEXT NOT NULL DEFAULT '[]',
      quotes TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'unread',
      queued_at INTEGER,
      shelf TEXT,
      word_count INTEGER NOT NULL DEFAULT 0,
      saved_at INTEGER NOT NULL,
      scroll REAL NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_items_url ON items(url) WHERE url IS NOT NULL;

    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_highlights_item ON highlights(item_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title, body, summary, tags,
      content='items', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, title, body, summary, tags)
      VALUES (new.rowid, new.title, new.body, new.summary, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, body, summary, tags)
      VALUES ('delete', old.rowid, old.title, old.body, old.summary, old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, body, summary, tags)
      VALUES ('delete', old.rowid, old.title, old.body, old.summary, old.tags);
      INSERT INTO items_fts(rowid, title, body, summary, tags)
      VALUES (new.rowid, new.title, new.body, new.summary, new.tags);
    END;
  `)

  // migrate DBs created before newer columns existed (structured markdown, typed items)
  const cols = (db.pragma('table_info(items)') as { name: string }[]).map((c) => c.name)
  if (!cols.includes('content')) db.exec('ALTER TABLE items ADD COLUMN content TEXT')
  if (!cols.includes('media_type')) db.exec("ALTER TABLE items ADD COLUMN media_type TEXT NOT NULL DEFAULT 'article'")
  if (!cols.includes('meta')) db.exec('ALTER TABLE items ADD COLUMN meta TEXT')

  return db
}

const uid = () => crypto.randomUUID()

const parseJson = (s: unknown): string[] => {
  try {
    const v = JSON.parse(typeof s === 'string' ? s : '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMeta(s: unknown): AtlasMeta | null {
  if (typeof s !== 'string' || !s) return null
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? (v as AtlasMeta) : null
  } catch {
    return null
  }
}

function rowToItem(r: any, withBody = false): AtlasItem {
  const item: AtlasItem = {
    id: r.id,
    kind: r.kind,
    mediaType: (r.media_type as MediaType) ?? 'article',
    url: r.url,
    domain: r.domain,
    title: r.title,
    excerpt: r.excerpt,
    summary: r.summary,
    keyPoints: parseJson(r.key_points),
    quotes: parseJson(r.quotes),
    tags: parseJson(r.tags),
    status: r.status,
    queuedAt: r.queued_at,
    shelf: r.shelf,
    wordCount: r.word_count,
    savedAt: r.saved_at,
    scroll: r.scroll,
    meta: parseMeta(r.meta),
  }
  if (withBody) {
    item.body = r.body
    item.content = r.content ?? undefined
  }
  return item
}

const LIST_COLS = 'id, kind, media_type, url, domain, title, excerpt, summary, key_points, quotes, tags, status, queued_at, shelf, word_count, saved_at, scroll, meta'

export function insertItem(fields: {
  kind: 'url' | 'text'
  mediaType?: MediaType
  url: string | null
  domain: string | null
  title: string
  body: string
  content?: string | null
  meta?: AtlasMeta | null
  excerpt: string | null
  shelf?: 'research' | null
}): AtlasItem {
  const id = uid()
  const wordCount = fields.body ? fields.body.trim().split(/\s+/).length : 0
  getDb()
    .prepare(
      `INSERT INTO items (id, kind, media_type, url, domain, title, body, content, meta, excerpt, shelf, word_count, saved_at)
       VALUES (@id, @kind, @mediaType, @url, @domain, @title, @body, @content, @meta, @excerpt, @shelf, @wordCount, @savedAt)`,
    )
    .run({
      id,
      ...fields,
      mediaType: fields.mediaType ?? 'article',
      content: fields.content ?? null,
      meta: fields.meta ? JSON.stringify(fields.meta) : null,
      shelf: fields.shelf ?? null,
      wordCount,
      savedAt: Date.now(),
    })
  return getItem(id)!
}

export function getItem(id: string, withBody = true): AtlasItem | null {
  const r = getDb().prepare('SELECT * FROM items WHERE id = ?').get(id)
  return r ? rowToItem(r, withBody) : null
}

export function getItemByUrl(url: string): AtlasItem | null {
  const r = getDb().prepare('SELECT * FROM items WHERE url = ?').get(url)
  return r ? rowToItem(r, true) : null
}

export function updateItem(
  id: string,
  patch: Partial<{
    title: string
    status: AtlasStatus
    queuedAt: number | null
    scroll: number
    tags: string[]
    shelf: 'research' | null
    summary: string
    keyPoints: string[]
    quotes: string[]
  }>,
): AtlasItem | null {
  const sets: string[] = []
  const params: Record<string, unknown> = { id }
  const map: Record<string, string> = {
    title: 'title',
    status: 'status',
    queuedAt: 'queued_at',
    scroll: 'scroll',
    shelf: 'shelf',
    summary: 'summary',
  }
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) {
      sets.push(`${col} = @${k}`)
      params[k] = (patch as Record<string, unknown>)[k]
    }
  }
  for (const k of ['tags', 'keyPoints', 'quotes'] as const) {
    if (patch[k]) {
      const col = k === 'tags' ? 'tags' : k === 'keyPoints' ? 'key_points' : 'quotes'
      sets.push(`${col} = @${k}`)
      params[k] = JSON.stringify(patch[k])
    }
  }
  if (sets.length) getDb().prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = @id`).run(params)
  return getItem(id, false)
}

export function deleteItem(id: string): boolean {
  return getDb().prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0
}

/** Build a safe FTS5 MATCH expression: every token quoted, last token as prefix. */
function ftsQuery(q: string): string {
  const tokens = q.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"`)
  if (tokens.length === 0) return ''
  tokens[tokens.length - 1] += '*'
  return tokens.join(' ')
}

export function listItems(filters: AtlasFilters = {}): AtlasItem[] {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}

  if (filters.status === 'queued') where.push('queued_at IS NOT NULL')
  else if (filters.status) {
    where.push('status = @status')
    params.status = filters.status
  }
  if (filters.domain) {
    where.push('domain = @domain')
    params.domain = filters.domain
  }
  if (filters.shelf === 'research') where.push("shelf = 'research'")
  else if (filters.shelf === 'none') where.push('shelf IS NULL')

  let ids: Set<string> | null = null
  const q = filters.query?.trim()
  if (q) {
    ids = new Set<string>()
    try {
      const match = ftsQuery(q)
      if (match) {
        for (const r of d
          .prepare('SELECT i.id AS id FROM items_fts f JOIN items i ON i.rowid = f.rowid WHERE items_fts MATCH ?')
          .all(match) as { id: string }[]) {
          ids.add(r.id)
        }
      }
    } catch {
      // odd token sequences can break FTS syntax — fall through to LIKE only
    }
    const like = `%${q}%`
    for (const r of d
      .prepare('SELECT id FROM items WHERE title LIKE ? OR summary LIKE ?')
      .all(like, like) as { id: string }[]) {
      ids.add(r.id)
    }
    // matches inside highlight quotes / margin notes surface the parent item
    for (const r of d
      .prepare('SELECT DISTINCT item_id AS id FROM highlights WHERE text LIKE ? OR note LIKE ?')
      .all(like, like) as { id: string }[]) {
      ids.add(r.id)
    }
  }

  const sql = `SELECT ${LIST_COLS} FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY (queued_at IS NULL), queued_at ASC, saved_at DESC`
  let rows = d.prepare(sql).all(params).map((r) => rowToItem(r))
  if (ids) rows = rows.filter((r) => ids.has(r.id))
  if (filters.tag) rows = rows.filter((r) => r.tags.includes(filters.tag!))
  return rows
}

export function facets(): { tags: string[]; domains: string[] } {
  const d = getDb()
  const tags = new Set<string>()
  for (const r of d.prepare('SELECT tags FROM items').all() as { tags: string }[]) {
    for (const t of parseJson(r.tags)) tags.add(t)
  }
  const domains = (d
    .prepare('SELECT DISTINCT domain FROM items WHERE domain IS NOT NULL ORDER BY domain')
    .all() as { domain: string }[]).map((r) => r.domain)
  return { tags: [...tags].sort(), domains }
}

/* ---------------- highlights ---------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowToHighlight = (r: any): AtlasHighlight => ({
  id: r.id,
  itemId: r.item_id,
  text: r.text,
  note: r.note,
  createdAt: r.created_at,
  ...(r.item_title !== undefined ? { itemTitle: r.item_title } : {}),
})

export function addHighlight(itemId: string, text: string, note = ''): AtlasHighlight | null {
  if (!getItem(itemId, false)) return null
  const id = uid()
  getDb()
    .prepare('INSERT INTO highlights (id, item_id, text, note, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, itemId, text, note, Date.now())
  const r = getDb().prepare('SELECT * FROM highlights WHERE id = ?').get(id)
  return rowToHighlight(r)
}

export function updateHighlight(id: string, note: string): boolean {
  return getDb().prepare('UPDATE highlights SET note = ? WHERE id = ?').run(note, id).changes > 0
}

export function deleteHighlight(id: string): boolean {
  return getDb().prepare('DELETE FROM highlights WHERE id = ?').run(id).changes > 0
}

export function itemHighlights(itemId: string): AtlasHighlight[] {
  return getDb()
    .prepare('SELECT * FROM highlights WHERE item_id = ? ORDER BY created_at ASC')
    .all(itemId)
    .map(rowToHighlight)
}

export function allHighlights(query?: string): AtlasHighlight[] {
  const d = getDb()
  const base = `SELECT h.*, i.title AS item_title FROM highlights h JOIN items i ON i.id = h.item_id`
  const rows = query?.trim()
    ? d.prepare(`${base} WHERE h.text LIKE ? OR h.note LIKE ? OR i.title LIKE ? ORDER BY h.created_at DESC`).all(
        ...Array(3).fill(`%${query.trim()}%`),
      )
    : d.prepare(`${base} ORDER BY h.created_at DESC`).all()
  return rows.map(rowToHighlight)
}

/* ---------------- related ---------------- */

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with', 'is', 'are', 'how', 'why', 'what', 'your', 'you'])
const titleWords = (t: string) =>
  new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))

/** Deliberately dumb: tag overlap + title keyword overlap. Upgradeable without UI changes. */
export function relatedItems(id: string, limit = 4): AtlasItem[] {
  const item = getItem(id, false)
  if (!item) return []
  const myTags = new Set(item.tags)
  const myWords = titleWords(item.title)
  return listItems()
    .filter((o) => o.id !== id)
    .map((o) => {
      const tagScore = o.tags.filter((t) => myTags.has(t)).length * 2
      const wordScore = [...titleWords(o.title)].filter((w) => myWords.has(w)).length
      return { o, score: tagScore + wordScore }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.o)
}
