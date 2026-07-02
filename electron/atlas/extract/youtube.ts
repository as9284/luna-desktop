import { USER_AGENT } from '../../search/constants'
import { fetchHtml } from '../../search/http'
import { parseMeta } from './meta'
import type { AtlasMeta, Resolved } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A video can't be archived — capture it as a card: thumbnail + channel + description. */

export function isYouTube(host: string): boolean {
  return /(^|\.)youtube\.com$/i.test(host) || /(^|\.)youtu\.be$/i.test(host)
}

function videoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1) || null
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null
    return u.searchParams.get('v')
  } catch {
    return null
  }
}

export async function extractYouTube(url: string, signal: AbortSignal): Promise<Resolved | null> {
  const id = videoId(url)

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
  const res = await fetch(oembedUrl, {
    signal,
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  }).catch(() => null)
  const o: any = res && res.ok ? await res.json().catch(() => null) : null
  if (!o && !id) return null

  // oEmbed gives title + channel + thumbnail but no description — pull that from og tags
  const http = await fetchHtml(url, signal).catch(() => null)
  const pm = http?.ok && http.html ? parseMeta(http.html, http.finalUrl || url) : null

  const title = o?.title || pm?.title || 'YouTube video'
  const channel = o?.author_name || pm?.author || null
  const thumb = (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null) || o?.thumbnail_url || pm?.image || null
  const description = pm?.description || null

  const md: string[] = []
  if (thumb) md.push(`![](${thumb})`)
  if (description) md.push(description)

  const meta: AtlasMeta = {
    ...(channel ? { author: channel } : {}),
    siteName: 'YouTube',
    ...(thumb ? { hero: thumb } : {}),
  }

  const body = [title, channel, description].filter(Boolean).join('\n\n')

  return {
    ok: true,
    mediaType: 'video',
    title,
    body,
    content: md.join('\n\n'),
    excerpt: (description || title).slice(0, 200),
    meta,
  }
}
