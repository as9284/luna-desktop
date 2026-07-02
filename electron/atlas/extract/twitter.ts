import { USER_AGENT } from '../../search/constants'
import type { AtlasMeta, QuotedPost, Resolved } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * X/Twitter is a login-walled SPA — a plain fetch returns "JavaScript is not available"
 * and a render returns a login modal, so Readability produces garbage. Instead we hit the
 * public tweet-syndication endpoint that every tweet-embed widget uses. No auth, no key.
 */

const ID_RE = /(?:twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/(\d+)/i

export function tweetId(url: string): string | null {
  return url.match(ID_RE)?.[1] ?? null
}

export function isTwitter(host: string): boolean {
  return /(^|\.)(twitter|x)\.com$/i.test(host) || /(^|\.)nitter\./i.test(host)
}

/** The token the syndication CDN expects — derived from the tweet id (react-tweet's algo). */
function token(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')
}

/** Replace t.co shorteners with their expanded targets and drop the trailing media t.co. */
function cleanText(text: string, urls?: any[]): string {
  let out = text || ''
  for (const u of urls ?? []) {
    if (u?.url && u?.expanded_url) out = out.split(u.url).join(u.expanded_url)
  }
  // media links have no entities.urls entry and sit at the very end as a bare t.co
  return out.replace(/\s*https?:\/\/t\.co\/\w+\s*$/i, '').trim()
}

function photosOf(t: any): string[] {
  const details: string[] = (t.mediaDetails ?? [])
    .map((m: any) => (m.type === 'photo' ? m.media_url_https : m.type === 'video' || m.type === 'animated_gif' ? m.media_url_https : null))
    .filter(Boolean)
  if (details.length) return details
  return (t.photos ?? []).map((p: any) => p.url).filter(Boolean)
}

function quotedOf(t: any): QuotedPost | undefined {
  const q = t.quoted_tweet
  if (!q) return undefined
  return {
    author: q.user?.name,
    handle: q.user?.screen_name ? `@${q.user.screen_name}` : undefined,
    text: cleanText(q.text ?? '', q.entities?.urls),
    media: photosOf(q),
  }
}

export async function extractTweet(url: string, signal: AbortSignal): Promise<Resolved | null> {
  const id = tweetId(url)
  if (!id) return null

  const api = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${token(id)}`
  const res = await fetch(api, {
    signal,
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  }).catch(() => null)
  if (!res || !res.ok) return null

  const t: any = await res.json().catch(() => null)
  // tombstones / deleted / protected tweets come back without a user+text
  if (!t || t.__typename === 'TweetTombstone' || !t.user || typeof t.text !== 'string') return null

  const author: string = t.user.name ?? t.user.screen_name ?? 'Unknown'
  const handle = t.user.screen_name ? `@${t.user.screen_name}` : undefined
  const text = cleanText(t.text, t.entities?.urls)
  const photos = photosOf(t)
  const quoted = quotedOf(t)

  // reader markdown: the post text, then each photo, then the quoted post as a blockquote.
  // (the reader renders a restricted subset — paragraphs, > quotes, ## headings, ![]() —
  //  so no inline bold / links here.)
  const md: string[] = []
  if (text) md.push(text)
  for (const p of photos) md.push(`![](${p})`)
  if (quoted) {
    const head = ['Quoting', quoted.author, quoted.handle].filter(Boolean).join(' ')
    md.push(`${head}:`)
    if (quoted.text) md.push(`> ${quoted.text.replace(/\n+/g, '\n> ')}`)
    for (const p of quoted.media ?? []) md.push(`![](${p})`)
  }

  const meta: AtlasMeta = {
    author,
    ...(handle ? { handle } : {}),
    ...(t.user.profile_image_url_https ? { avatar: t.user.profile_image_url_https } : {}),
    siteName: 'X',
    ...(t.created_at ? { publishedAt: t.created_at } : {}),
    ...(photos.length ? { media: photos } : {}),
    ...(quoted ? { quoted } : {}),
    ...(typeof t.favorite_count === 'number' ? { stats: [{ label: 'likes', value: String(t.favorite_count) }] } : {}),
  }

  const body = [`${author} ${handle ?? ''}`.trim(), text, quoted?.text].filter(Boolean).join('\n\n')
  const title = `${author} on X: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`

  return {
    ok: true,
    mediaType: 'social',
    title,
    body,
    content: md.join('\n\n'),
    excerpt: text.slice(0, 200) || null,
    meta,
  }
}
