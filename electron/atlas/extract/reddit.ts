import { USER_AGENT } from '../../search/constants'
import type { AtlasMeta, Resolved } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Reddit serves clean JSON for any post by appending `.json` to the permalink. Keyless. */

export function isReddit(host: string): boolean {
  return /(^|\.)reddit\.com$/i.test(host) || /(^|\.)redd\.it$/i.test(host)
}

const IMG_EXT = /\.(png|jpe?g|gif|webp)$/i

interface Comment {
  author: string
  body: string
}

function topComments(listing: any, max = 8): Comment[] {
  const children = listing?.data?.children ?? []
  const out: Comment[] = []
  for (const c of children) {
    if (c.kind !== 't1') continue
    const d = c.data
    if (!d || d.stickied || typeof d.body !== 'string' || !d.body.trim()) continue
    const who = d.author && d.author !== '[deleted]' ? `u/${d.author}` : 'someone'
    const score = typeof d.score === 'number' ? ` · ${d.score} points` : ''
    out.push({ author: `${who}${score}`, body: d.body.trim() })
    if (out.length >= max) break
  }
  return out
}

export async function extractReddit(url: string, signal: AbortSignal): Promise<Resolved | null> {
  const jsonUrl = url.replace(/\/?(\?.*)?$/, '') + '.json'
  const res = await fetch(jsonUrl, {
    signal,
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  }).catch(() => null)
  if (!res || !res.ok) return null

  const data: any = await res.json().catch(() => null)
  const post = Array.isArray(data) ? data[0]?.data?.children?.[0]?.data : null
  if (!post || typeof post.title !== 'string') return null

  const author = post.author && post.author !== '[deleted]' ? `u/${post.author}` : null
  const sub = post.subreddit ? `r/${post.subreddit}` : null
  const selftext: string = typeof post.selftext === 'string' ? post.selftext.trim() : ''
  const linkOut: string | null =
    post.url_overridden_by_dest && !/reddit\.com/.test(post.url_overridden_by_dest) ? post.url_overridden_by_dest : null
  const preview: string | null =
    post.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&') ||
    (linkOut && IMG_EXT.test(linkOut) ? linkOut : null) ||
    null

  const md: string[] = []
  if (preview) md.push(`![](${preview})`)
  if (selftext) md.push(selftext)
  if (linkOut && !IMG_EXT.test(linkOut)) md.push(linkOut)

  const comments = topComments(Array.isArray(data) ? data[1] : null)
  if (comments.length) {
    md.push('## Top comments')
    for (const c of comments) {
      md.push(c.author)
      md.push(`> ${c.body.replace(/\n+/g, '\n> ')}`)
    }
  }

  const meta: AtlasMeta = {
    ...(author ? { author } : {}),
    ...(sub ? { handle: sub } : {}),
    siteName: 'Reddit',
    ...(preview ? { hero: preview } : {}),
    ...(typeof post.created_utc === 'number' ? { publishedAt: new Date(post.created_utc * 1000).toISOString() } : {}),
    stats: [
      ...(typeof post.score === 'number' ? [{ label: 'points', value: String(post.score) }] : []),
      ...(typeof post.num_comments === 'number' ? [{ label: 'comments', value: String(post.num_comments) }] : []),
    ],
  }

  const body = [post.title, selftext, ...comments.map((c) => `${c.author}: ${c.body}`)].filter(Boolean).join('\n\n')

  return {
    ok: true,
    mediaType: 'social',
    title: post.title,
    body,
    content: md.join('\n\n') || null,
    excerpt: (selftext || post.title).slice(0, 200),
    meta,
  }
}
