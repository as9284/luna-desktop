import { fetchContent } from '../../search/content'
import type { Resolved } from './types'

/** The generic path: the existing Readability fetch/extract ladder, typed as an article. */
export async function extractArticle(url: string, signal: AbortSignal): Promise<Resolved> {
  const doc = await fetchContent(url, signal).catch(() => null)
  if (!doc || !doc.ok || !doc.text.trim()) {
    return { ok: false, mediaType: 'article', title: null, body: '', content: null, excerpt: null, meta: null }
  }
  return {
    ok: true,
    mediaType: 'article',
    title: doc.title,
    body: doc.text,
    content: doc.markdown?.trim() || null,
    excerpt: doc.excerpt,
    meta: null,
  }
}
