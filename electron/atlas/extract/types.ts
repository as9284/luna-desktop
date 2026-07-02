/**
 * The shape every link handler returns. `body` is plain text (search / word count /
 * LLM digest); `content` is reader markdown (paragraphs, images, quotes) — null means
 * the reader falls back to splitting `body` into paragraphs. `meta` carries the typed
 * chrome the reader renders above the body (author, avatar, hero image, …).
 */
export type MediaType = 'article' | 'social' | 'video' | 'image' | 'pdf' | 'stub'

export interface QuotedPost {
  author?: string
  handle?: string
  text?: string
  media?: string[]
}

export interface AtlasMeta {
  /** display name of the author / channel / poster */
  author?: string
  /** @handle or u/name or r/sub */
  handle?: string
  /** author avatar / profile image url */
  avatar?: string
  /** platform label shown on the type badge, e.g. "X", "Reddit", "YouTube" */
  siteName?: string
  /** ISO date or human string */
  publishedAt?: string
  /** inline media (tweet photos, etc.) */
  media?: string[]
  /** the lead image / video thumbnail */
  hero?: string
  /** video length, "12:04" */
  duration?: string
  /** page count for PDFs */
  pages?: number
  /** a quoted / embedded post (quoted tweet) */
  quoted?: QuotedPost
  /** small stat chips: likes, points, comments */
  stats?: { label: string; value: string }[]
}

export interface Resolved {
  ok: boolean
  mediaType: MediaType
  title: string | null
  body: string
  content: string | null
  excerpt: string | null
  meta: AtlasMeta | null
}

export const emptyResolved: Resolved = {
  ok: false,
  mediaType: 'article',
  title: null,
  body: '',
  content: null,
  excerpt: null,
  meta: null,
}
