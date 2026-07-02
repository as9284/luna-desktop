import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getItem, itemHighlights, type AtlasItem } from './db'

const fmtDate = (ts: number) => new Date(ts).toISOString().slice(0, 10)

export function itemToMarkdown(item: AtlasItem): string {
  const highlights = itemHighlights(item.id)
  const meta = [item.domain, fmtDate(item.savedAt), item.wordCount ? `${item.wordCount} words` : null]
    .filter(Boolean)
    .join(' · ')
  const parts: string[] = [`# ${item.title}`, '']
  if (meta) parts.push(meta, '')
  if (item.url) parts.push(`<${item.url}>`, '')
  if (item.tags.length) parts.push(item.tags.map((t) => `#${t}`).join(' '), '')
  if (item.summary) parts.push('## Summary', '', item.summary, '')
  if (item.keyPoints.length) parts.push('## Key points', '', ...item.keyPoints.map((k) => `- ${k}`), '')
  if (item.quotes.length) parts.push('## Quotes', '', ...item.quotes.map((q) => `> ${q}`), '')
  if (highlights.length) {
    parts.push('## Highlights', '')
    for (const h of highlights) {
      parts.push(`> ${h.text.replace(/\n/g, '\n> ')}`)
      if (h.note) parts.push('', `*${h.note}*`)
      parts.push('')
    }
  }
  const article = item.content?.trim() || item.body?.trim()
  if (article) parts.push('## Article', '', article, '')
  return parts.join('\n')
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled'

export interface ExportResult {
  ok: boolean
  canceled?: boolean
  path?: string
  count?: number
  error?: string
}

/** One id → save-file dialog; several → pick a folder and write one .md per item. */
export async function exportItems(win: BrowserWindow | null, ids: string[]): Promise<ExportResult> {
  const items = ids.map((id) => getItem(id)).filter((i): i is AtlasItem => !!i)
  if (items.length === 0) return { ok: false, error: 'Nothing to export.' }

  try {
    if (items.length === 1) {
      const item = items[0]
      const res = win
        ? await dialog.showSaveDialog(win, {
            title: 'Export as Markdown',
            defaultPath: `${slug(item.title)}.md`,
            filters: [{ name: 'Markdown', extensions: ['md'] }],
          })
        : { canceled: true as const, filePath: undefined }
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      fs.writeFileSync(res.filePath, itemToMarkdown(item), 'utf8')
      return { ok: true, path: res.filePath, count: 1 }
    }

    const res = win
      ? await dialog.showOpenDialog(win, { title: 'Export library to folder', properties: ['openDirectory', 'createDirectory'] })
      : { canceled: true as const, filePaths: [] as string[] }
    if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true }
    const dir = res.filePaths[0]
    const used = new Set<string>()
    for (const item of items) {
      let name = slug(item.title)
      for (let n = 2; used.has(name); n++) name = `${slug(item.title)}-${n}`
      used.add(name)
      fs.writeFileSync(path.join(dir, `${name}.md`), itemToMarkdown(item), 'utf8')
    }
    return { ok: true, path: dir, count: items.length }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
