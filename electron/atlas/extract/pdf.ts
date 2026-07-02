import { USER_AGENT } from '../../search/constants'
import type { AtlasMeta, Resolved } from './types'

/**
 * Direct PDF links: download the file and pull its text layer with unpdf (a pure-JS,
 * no-native pdf.js wrapper), so a PDF becomes a readable, searchable item — not just an
 * "open elsewhere" link. Scanned / image-only / encrypted PDFs have no text layer, so we
 * fall back to a typed card that opens the original.
 */

const PDF_EXT = /\.pdf(\?|#|$)/i
const MAX_BYTES = 30 * 1024 * 1024
const MAX_PAGES = 200
const MAX_CHARS = 500_000

export function isPdf(url: string): boolean {
  return PDF_EXT.test(url)
}

function fileName(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || url
    return decodeURIComponent(last).replace(/\.pdf$/i, '')
  } catch {
    return url.replace(/\.pdf$/i, '')
  }
}

/**
 * Reflow a page's text layer back into paragraphs. PDF text comes out one visual line at
 * a time; a real paragraph ends where a line ends with sentence punctuation (or a blank
 * line). Wrapped lines are joined with a space, line-end hyphens are stitched back.
 */
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
    if (!line) {
      flush()
      continue
    }
    cur = cur ? `${cur} ${line}` : line
    if (/[.!?]["'’)\]]?$/.test(line)) flush()
  }
  flush()
  return paras.join('\n\n')
}

/** Typed card for a PDF we couldn't read text from — the reader offers "Open PDF". */
function pdfStub(url: string): Resolved {
  const name = fileName(url)
  return {
    ok: true,
    mediaType: 'pdf',
    title: name,
    body: name,
    content: null,
    excerpt: null,
    meta: { siteName: 'PDF' },
  }
}

export async function extractPdf(url: string, signal: AbortSignal): Promise<Resolved | null> {
  if (!isPdf(url)) return null
  try {
    const res = await fetch(url, { signal, headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*' } })
    if (!res.ok) return pdfStub(url)
    // some .pdf URLs are actually a login/HTML wall — never feed that to the parser
    if (/text\/html/i.test(res.headers.get('content-type') || '')) return pdfStub(url)

    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length > MAX_BYTES || buf.length < 5) return pdfStub(url)

    const { extractText } = await import('unpdf')
    const { totalPages, text } = await extractText(buf, { mergePages: false })

    const pages = text.slice(0, MAX_PAGES).map(reflow).filter(Boolean)
    let content = pages.join('\n\n')
    if (!content.trim()) return pdfStub(url) // scanned / image-only / no text layer
    if (content.length > MAX_CHARS) {
      content = content.slice(0, MAX_CHARS).trimEnd() + '\n\n[Truncated — open the original PDF for the full text.]'
    }

    const name = fileName(url)
    const meta: AtlasMeta = { siteName: 'PDF', pages: totalPages }
    return {
      ok: true,
      mediaType: 'pdf',
      title: name,
      body: content,
      content,
      excerpt: content.slice(0, 200),
      meta,
    }
  } catch {
    return pdfStub(url)
  }
}
