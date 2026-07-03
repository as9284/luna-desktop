import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Turn a file on disk into text Luna can reason over. Dispatches by extension:
 *   - text / code / json / csv / md / xml / yaml → read as UTF-8
 *   - .pdf   → unpdf text layer (reflowed into paragraphs)
 *   - .docx  → mammoth raw text
 *   - .xlsx  → exceljs, sheets flattened to CSV-ish text
 *   - anything else → detected as binary, returned as a short note (never a garbage dump)
 *
 * Heavy parsers are dynamically imported (like the existing Atlas unpdf path) and wrapped so
 * a missing/broken parser degrades to a friendly message instead of crashing the app.
 *
 * The caller is responsible for passing an already path-guarded real path — extraction reads
 * bytes directly and does no permission checks of its own.
 */

const MAX_BYTES = 30 * 1024 * 1024 // don't load monsters into memory
const MAX_CHARS = 400_000 // cap what enters the model context

export type ExtractKind = 'text' | 'code' | 'data' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'binary'

export interface ExtractResult {
  ok: boolean
  kind: ExtractKind
  text: string
  truncated?: boolean
  meta?: Record<string, unknown>
  error?: string
}

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.rst', '.log', '.text',
  '.json', '.jsonc', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.toml', '.ini', '.env.sample',
  '.html', '.htm', '.css', '.scss', '.less',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.php', '.swift', '.sh', '.bash', '.zsh', '.ps1',
  '.sql', '.r', '.lua', '.pl', '.dart', '.vue', '.svelte', '.astro', '.graphql', '.proto',
])
const DATA_EXT = new Set(['.json', '.jsonc', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.toml', '.ini'])

const cap = (s: string): { text: string; truncated: boolean } => {
  if (s.length <= MAX_CHARS) return { text: s, truncated: false }
  return { text: s.slice(0, MAX_CHARS).trimEnd() + '\n\n[Truncated — file continues beyond the context limit.]', truncated: true }
}

/** PDF text comes out one visual line at a time; rebuild paragraphs. (Same heuristic as Atlas.) */
function reflow(page: string): string {
  const dehyphenated = page.replace(/([A-Za-z])-\n([a-z])/g, '$1$2')
  const lines = dehyphenated.split('\n').map((l) => l.replace(/\s+/g, ' ').trim())
  const paras: string[] = []
  let cur = ''
  const flush = () => {
    if (cur.trim()) paras.push(cur.trim())
    cur = ''
  }
  for (const line of lines) {
    if (!line) { flush(); continue }
    cur = cur ? `${cur} ${line}` : line
    if (/[.!?]["'’)\]]?$/.test(line)) flush()
  }
  flush()
  return paras.join('\n\n')
}

/** Heuristic: a NUL byte in the first chunk means it's binary, not text. */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

async function extractPdf(real: string): Promise<ExtractResult> {
  try {
    const buf = new Uint8Array(await fs.readFile(real))
    const { extractText } = await import('unpdf')
    const { totalPages, text } = await extractText(buf, { mergePages: false })
    const body = (text as string[]).map(reflow).filter(Boolean).join('\n\n')
    if (!body.trim()) return { ok: false, kind: 'pdf', text: '', error: 'This PDF has no text layer (scanned or image-only).' }
    const { text: t, truncated } = cap(body)
    return { ok: true, kind: 'pdf', text: t, truncated, meta: { pages: totalPages } }
  } catch (e) {
    return { ok: false, kind: 'pdf', text: '', error: `Could not read the PDF: ${e instanceof Error ? e.message : String(e)}` }
  }
}

async function extractDocx(real: string): Promise<ExtractResult> {
  try {
    // CJS interop: the module may come through as-is or under `.default` depending on bundler
    const mod = (await import('mammoth')) as unknown as { default?: unknown; extractRawText?: unknown }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mammoth = ((mod.default ?? mod) as any)
    const { value } = (await mammoth.extractRawText({ path: real })) as { value: string }
    if (!value.trim()) return { ok: false, kind: 'docx', text: '', error: 'The document appears to be empty.' }
    const { text, truncated } = cap(value)
    return { ok: true, kind: 'docx', text, truncated }
  } catch (e) {
    return { ok: false, kind: 'docx', text: '', error: `Could not read the Word document: ${e instanceof Error ? e.message : String(e)}` }
  }
}

async function extractXlsx(real: string): Promise<ExtractResult> {
  try {
    const mod = (await import('exceljs')) as unknown as { default?: unknown; Workbook?: unknown }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ExcelJS = (mod.default ?? mod) as any
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(real)
    const parts: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wb.eachSheet((sheet: any) => {
      const rows: string[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sheet.eachRow((row: any) => {
        const cells: string[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row.eachCell({ includeEmpty: true }, (cell: any) => {
          const v = String(cell.text ?? '')
          cells.push(/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
        })
        rows.push(cells.join(','))
      })
      if (rows.length) parts.push(`# Sheet: ${sheet.name}\n${rows.join('\n')}`)
    })
    const body = parts.join('\n\n')
    if (!body.trim()) return { ok: false, kind: 'xlsx', text: '', error: 'The spreadsheet has no readable cells.' }
    const { text, truncated } = cap(body)
    return { ok: true, kind: 'xlsx', text, truncated, meta: { sheets: wb.worksheets.length } }
  } catch (e) {
    return { ok: false, kind: 'xlsx', text: '', error: `Could not read the spreadsheet: ${e instanceof Error ? e.message : String(e)}` }
  }
}

async function extractPptx(real: string): Promise<ExtractResult> {
  try {
    const { extractPptxText } = await import('./pptx')
    const bytes = new Uint8Array(await fs.readFile(real))
    const body = await extractPptxText(bytes)
    if (!body.trim()) return { ok: false, kind: 'pptx', text: '', error: 'This presentation has no readable text.' }
    const { text, truncated } = cap(body)
    const slides = (body.match(/^# Slide /gm) || []).length
    return { ok: true, kind: 'pptx', text, truncated, meta: { slides } }
  } catch (e) {
    return { ok: false, kind: 'pptx', text: '', error: `Could not read the presentation: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function extractDocument(real: string): Promise<ExtractResult> {
  const ext = path.extname(real).toLowerCase()
  let size = 0
  try {
    size = (await fs.stat(real)).size
  } catch (e) {
    return { ok: false, kind: 'binary', text: '', error: e instanceof Error ? e.message : String(e) }
  }
  if (size > MAX_BYTES) return { ok: false, kind: 'binary', text: '', error: `File is too large (${(size / 1048576).toFixed(1)} MB).` }

  if (ext === '.pdf') return extractPdf(real)
  if (ext === '.docx') return extractDocx(real)
  if (ext === '.xlsx' || ext === '.xlsm') return extractXlsx(real)
  if (ext === '.pptx') return extractPptx(real)

  if (TEXT_EXT.has(ext)) {
    const buf = await fs.readFile(real)
    if (looksBinary(buf)) return { ok: false, kind: 'binary', text: '', error: 'This file looks binary, not text.' }
    const { text, truncated } = cap(buf.toString('utf8'))
    return { ok: true, kind: DATA_EXT.has(ext) ? 'data' : ext === '.txt' || ext === '.md' || ext === '.markdown' ? 'text' : 'code', text, truncated }
  }

  // unknown extension — try text if it isn't binary, else report it as binary
  const buf = await fs.readFile(real)
  if (looksBinary(buf)) {
    return { ok: false, kind: 'binary', text: '', error: `Binary file (${ext || 'no extension'}, ${(size / 1024).toFixed(0)} KB) — Luna can't read its contents as text.` }
  }
  const { text, truncated } = cap(buf.toString('utf8'))
  return { ok: true, kind: 'text', text, truncated }
}
