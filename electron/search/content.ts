import { fetchHtml } from './http'
import { renderHtml } from './browser'
import { extractArticle } from './readability'
import { THIN_TEXT_CHARS } from './constants'

export interface FetchedDocument {
  title: string | null
  text: string
  /** structured markdown (paragraphs, images, formatting) — for the Atlas reader */
  markdown: string
  excerpt: string | null
  ok: boolean
}

/** Small in-memory snapshot cache so repeat fetches within a session are free. */
const cache = new Map<string, FetchedDocument>()
const CACHE_MAX = 100

async function tryBrowser(url: string, signal: AbortSignal): Promise<FetchedDocument | null> {
  try {
    const html = await renderHtml(url, signal)
    if (!html) return null
    return { ...extractArticle(html, url), ok: true }
  } catch {
    return null
  }
}

/**
 * Quality-driven escalation: try a fast HTTP fetch + extraction; if the result is thin
 * (or the fetch failed), fall through to a rendered fetch. Returns the better of the two.
 */
export async function fetchContent(url: string, signal: AbortSignal): Promise<FetchedDocument> {
  const cached = cache.get(url)
  if (cached) return cached

  const result = await fetchContentUncached(url, signal)
  if (result.ok) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
    cache.set(url, result)
  }
  return result
}

async function fetchContentUncached(url: string, signal: AbortSignal): Promise<FetchedDocument> {
  const http = await fetchHtml(url, signal)

  if (http.ok && http.html) {
    const ex = extractArticle(http.html, http.finalUrl || url)
    if (ex.text.length >= THIN_TEXT_CHARS) return { ...ex, ok: true }

    const browserDoc = await tryBrowser(url, signal)
    if (browserDoc && browserDoc.text.length > ex.text.length) return browserDoc
    return { ...ex, ok: true }
  }

  const browserDoc = await tryBrowser(url, signal)
  if (browserDoc) return browserDoc

  return { title: null, text: '', markdown: '', excerpt: null, ok: false }
}
