import { parseHTML } from 'linkedom'
import { fetchHtml } from '../../search/http'
import type { AtlasMeta, Resolved } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Read the social/meta hero tags a site advertises (og:*, twitter:*, <meta name>). */
export interface PageMeta {
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
  author: string | null
  type: string | null
}

const abs = (src: string | null, base: string): string | null => {
  if (!src) return null
  try {
    return new URL(src, base).href
  } catch {
    return src
  }
}

export function parseMeta(html: string, baseUrl: string): PageMeta {
  const { document } = parseHTML(html)
  const pick = (sel: string, attr = 'content'): string | null => {
    const el = document.querySelector(sel) as any
    const v = el?.getAttribute?.(attr) ?? el?.textContent
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  return {
    title:
      pick('meta[property="og:title"]') ||
      pick('meta[name="twitter:title"]') ||
      pick('title', 'textContent') ||
      null,
    description:
      pick('meta[property="og:description"]') ||
      pick('meta[name="description"]') ||
      pick('meta[name="twitter:description"]') ||
      null,
    image: abs(
      pick('meta[property="og:image"]') || pick('meta[name="twitter:image"]') || pick('meta[name="twitter:image:src"]'),
      baseUrl,
    ),
    siteName: pick('meta[property="og:site_name"]'),
    author: pick('meta[name="author"]') || pick('meta[property="article:author"]'),
    type: pick('meta[property="og:type"]'),
  }
}

const hostLabel = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Turn a bare URL into a readable title when there's nothing else to go on. */
function titleFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() || u.hostname
    const words = decodeURIComponent(last)
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_+]/g, ' ')
      .trim()
    return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : u.hostname
  } catch {
    return url
  }
}

/**
 * Graceful failure: when nothing readable could be extracted (login/paywall, dead
 * page, JS-only shell), build a clean stub from whatever meta tags the page exposes —
 * title + hero image + one-line excerpt — instead of dumping page chrome as "text".
 * `knownMeta` lets a caller pass meta it already parsed to avoid a second fetch.
 */
export async function buildStub(url: string, signal: AbortSignal, knownMeta?: PageMeta): Promise<Resolved> {
  let meta = knownMeta ?? null
  if (!meta) {
    const http = await fetchHtml(url, signal).catch(() => null)
    if (http?.ok && http.html) meta = parseMeta(http.html, http.finalUrl || url)
  }

  const title = meta?.title || titleFromUrl(url)
  const excerpt = meta?.description || null
  const site = meta?.siteName || hostLabel(url)
  const atlasMeta: AtlasMeta = {
    siteName: site,
    ...(meta?.image ? { hero: meta.image } : {}),
    ...(meta?.author ? { author: meta.author } : {}),
  }
  // body keeps title + excerpt so the item is still searchable
  const body = [title, excerpt].filter(Boolean).join('\n\n')

  return {
    ok: true,
    mediaType: 'stub',
    title,
    body,
    content: null,
    excerpt,
    meta: atlasMeta,
  }
}
