import { searchWeb } from './web'
import { fetchContent } from './content'

const READ_TOP = 3
const MAX_DOC_CHARS = 2000
const MAX_SNIPPET_CHARS = 400

export interface ReadDoc {
  url: string
  title: string | null
  text: string
  markdown: string
}

/**
 * Search the web and read the top results, formatted as a single block of text for
 * the model to read as a tool result. Keyless end-to-end (DuckDuckGo HTML + Readability).
 * `onDocs` (optional) receives the successfully read pages — used by the Atlas
 * research shelf to archive what Luna actually read.
 */
export async function runWebSearch(query: string, signal: AbortSignal, onDocs?: (docs: ReadDoc[]) => void): Promise<string> {
  const hits = await searchWeb(query, signal)
  if (hits.length === 0) return `No web results found for "${query}".`

  const toRead = hits.slice(0, READ_TOP)
  const docs = await Promise.all(toRead.map((h) => fetchContent(h.url, signal).catch(() => null)))

  if (onDocs) {
    const read = toRead.flatMap((h, i) => {
      const doc = docs[i]
      return doc?.ok && doc.text
        ? [{ url: h.url, title: doc.title ?? h.title, text: doc.text, markdown: doc.markdown }]
        : []
    })
    if (read.length) onDocs(read)
  }

  const parts = hits.map((hit, i) => {
    const doc = i < toRead.length ? docs[i] : null
    const body = doc?.ok && doc.text ? doc.text.slice(0, MAX_DOC_CHARS) : hit.snippet.slice(0, MAX_SNIPPET_CHARS)
    return `### ${hit.title}\n${hit.url}\n${body}`
  })

  return parts.join('\n\n')
}
