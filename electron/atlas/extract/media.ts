import type { AtlasMeta, Resolved } from './types'

/** Direct image links (…/bar.jpg) that the HTML fetcher rejects outright. */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i

function fileName(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || url
    return decodeURIComponent(last)
  } catch {
    return url
  }
}

/** Detect + build a typed item for a direct image link, or null if it isn't one. */
export function extractImage(url: string): Resolved | null {
  if (!IMAGE_EXT.test(url)) return null
  const name = fileName(url)
  const meta: AtlasMeta = { siteName: 'Image', hero: url, media: [url] }
  return {
    ok: true,
    mediaType: 'image',
    title: name,
    body: name,
    content: `![${name}](${url})`,
    excerpt: null,
    meta,
  }
}
