import { extractArticle } from './article'
import { extractBluesky, isBluesky } from './bluesky'
import { extractHackerNews, hnId } from './hackernews'
import { extractImage } from './media'
import { extractPdf } from './pdf'
import { buildStub } from './meta'
import { extractReddit, isReddit } from './reddit'
import { extractTweet, isTwitter } from './twitter'
import { extractYouTube, isYouTube } from './youtube'
import type { Resolved } from './types'

export type { AtlasMeta, MediaType, Resolved } from './types'

/** Below this much extracted text, a generic page is treated as unreadable → clean stub. */
const MIN_ARTICLE_CHARS = 250

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Try the dedicated handler for a known platform; null if the URL isn't one / it failed. */
async function platform(url: string, host: string, signal: AbortSignal): Promise<Resolved | null> {
  try {
    if (isTwitter(host)) return await extractTweet(url, signal)
    if (isReddit(host)) return await extractReddit(url, signal)
    if (isYouTube(host)) return await extractYouTube(url, signal)
    if (isBluesky(host)) return await extractBluesky(url, signal)
    if (hnId(url)) return await extractHackerNews(url, signal)
  } catch {
    // any handler blowing up just means we fall through to the generic path
  }
  return null
}

/**
 * The one entry point Atlas saves through. Detects what a link *is* and extracts it the
 * right way (platform handler → direct-media → generic article), and if none of that
 * yields readable content, degrades to a clean stub instead of a page-chrome text dump.
 */
export async function resolveLink(url: string, signal: AbortSignal): Promise<Resolved> {
  const host = hostOf(url)

  const platformDoc = await platform(url, host, signal)
  if (platformDoc?.ok) return platformDoc

  const image = extractImage(url)
  if (image) return image

  const pdf = await extractPdf(url, signal)
  if (pdf) return pdf

  const article = await extractArticle(url, signal)
  if (article.ok && article.body.trim().length >= MIN_ARTICLE_CHARS) return article

  const stub = await buildStub(url, signal)
  // never lose real content: if the stub found nothing better and the article had *some*
  // text, keep the article rather than a bare stub
  if (!stub.excerpt && !stub.meta?.hero && article.ok && article.body.trim()) return article
  return stub
}
