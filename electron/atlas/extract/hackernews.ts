import { parseHTML } from 'linkedom'
import { USER_AGENT } from '../../search/constants'
import type { AtlasMeta, Resolved } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Hacker News: the Algolia API returns the story + threaded comments as JSON. Keyless. */

export function hnId(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/news\.ycombinator\.com$/i.test(u.hostname)) return null
    return u.searchParams.get('id')
  } catch {
    return null
  }
}

/** HN comment bodies are HTML fragments; flatten to plain text with paragraph breaks. */
function htmlToText(html: string): string {
  if (!html) return ''
  const withBreaks = html.replace(/<p>/gi, '\n\n').replace(/<\/?[^>]+>/g, '')
  const { document } = parseHTML(`<div>${withBreaks}</div>`)
  return (document.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

interface Comment {
  author: string
  body: string
}

function walkComments(children: any[], out: Comment[], max = 12): void {
  for (const c of children ?? []) {
    if (out.length >= max) return
    if (c?.text) out.push({ author: c.author || 'someone', body: htmlToText(c.text) })
    if (c?.children?.length) walkComments(c.children, out, max)
  }
}

export async function extractHackerNews(url: string, signal: AbortSignal): Promise<Resolved | null> {
  const id = hnId(url)
  if (!id) return null

  const res = await fetch(`https://hn.algolia.com/api/v1/items/${id}`, {
    signal,
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  }).catch(() => null)
  if (!res || !res.ok) return null

  const item: any = await res.json().catch(() => null)
  if (!item || (!item.title && !item.text)) return null

  const title = item.title || `Comment by ${item.author}`
  const storyText = item.text ? htmlToText(item.text) : ''
  const link = item.url || null

  const md: string[] = []
  if (storyText) md.push(storyText)
  if (link) md.push(link)
  const comments: Comment[] = []
  walkComments(item.children ?? [], comments)
  if (comments.length) {
    md.push('## Discussion')
    for (const c of comments) {
      md.push(c.author)
      md.push(`> ${c.body.replace(/\n+/g, '\n> ')}`)
    }
  }

  const meta: AtlasMeta = {
    ...(item.author ? { author: item.author } : {}),
    siteName: 'Hacker News',
    ...(item.created_at ? { publishedAt: item.created_at } : {}),
    stats: [
      ...(typeof item.points === 'number' ? [{ label: 'points', value: String(item.points) }] : []),
    ],
  }

  const body = [title, storyText, ...comments.map((c) => `${c.author}: ${c.body}`)].filter(Boolean).join('\n\n')

  return {
    ok: true,
    mediaType: 'social',
    title,
    body,
    content: md.join('\n\n') || null,
    excerpt: (storyText || title).slice(0, 200),
    meta,
  }
}
