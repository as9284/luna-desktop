import { USER_AGENT } from '../../search/constants'
import type { AtlasMeta, QuotedPost, Resolved } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Bluesky exposes a keyless read-only API (no login) — resolve the handle, fetch the post. */

const POST_RE = /bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/i

export function isBluesky(host: string): boolean {
  return /(^|\.)bsky\.app$/i.test(host)
}

const API = 'https://public.api.bsky.app/xrpc'

async function json(url: string, signal: AbortSignal): Promise<any | null> {
  const res = await fetch(url, { signal, headers: { 'user-agent': USER_AGENT, accept: 'application/json' } }).catch(
    () => null,
  )
  return res && res.ok ? res.json().catch(() => null) : null
}

/** Collect image urls from any of Bluesky's embed shapes. */
function embedImages(embed: any): string[] {
  if (!embed) return []
  const imgs = embed.images ?? embed.media?.images ?? []
  return imgs.map((i: any) => i.fullsize || i.thumb).filter(Boolean)
}

function quotedOf(embed: any): QuotedPost | undefined {
  const rec = embed?.record?.record ?? embed?.record
  if (!rec || !rec.value) return undefined
  return {
    author: rec.author?.displayName || rec.author?.handle,
    handle: rec.author?.handle ? `@${rec.author.handle}` : undefined,
    text: typeof rec.value.text === 'string' ? rec.value.text : undefined,
    media: embedImages(rec.embeds?.[0]),
  }
}

export async function extractBluesky(url: string, signal: AbortSignal): Promise<Resolved | null> {
  const m = url.match(POST_RE)
  if (!m) return null
  const [, rawHandle, rkey] = m

  let did = rawHandle
  if (!rawHandle.startsWith('did:')) {
    const r = await json(`${API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(rawHandle)}`, signal)
    if (!r?.did) return null
    did = r.did
  }

  const uri = `at://${did}/app.bsky.feed.post/${rkey}`
  const data = await json(`${API}/app.bsky.feed.getPostThread?depth=0&uri=${encodeURIComponent(uri)}`, signal)
  const post = data?.thread?.post
  if (!post?.record || typeof post.record.text !== 'string') return null

  const author = post.author?.displayName || post.author?.handle || 'Unknown'
  const handle = post.author?.handle ? `@${post.author.handle}` : undefined
  const text: string = post.record.text
  const photos = embedImages(post.embed)
  const quoted = quotedOf(post.embed)

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
    ...(post.author?.avatar ? { avatar: post.author.avatar } : {}),
    siteName: 'Bluesky',
    ...(post.record.createdAt ? { publishedAt: post.record.createdAt } : {}),
    ...(photos.length ? { media: photos } : {}),
    ...(quoted ? { quoted } : {}),
    ...(typeof post.likeCount === 'number' ? { stats: [{ label: 'likes', value: String(post.likeCount) }] } : {}),
  }

  const body = [`${author} ${handle ?? ''}`.trim(), text, quoted?.text].filter(Boolean).join('\n\n')
  const title = `${author} on Bluesky: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`

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
