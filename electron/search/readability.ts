import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'

export interface Extracted {
  title: string | null
  /** clean plain text, blocks separated by blank lines — for search, LLM, word count */
  text: string
  /** structured markdown (paragraphs, headings, quotes, lists, images) — for the reader */
  markdown: string
  excerpt: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Lazy-load spacers to skip: sites put these in `src` and the real image in srcset/data-src. */
const PLACEHOLDER = /(?:^data:)|placeholder|blank|spacer|transparent|1x1|grey[-_.]|\/grey\.|loading/i

/** Pick the highest-resolution candidate from a srcset string, skipping data-URIs. */
function largestSrc(srcset: string): string {
  const cands = srcset
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const bits = part.split(/\s+/)
      const d = bits[1] || ''
      const w = d.endsWith('w') ? parseInt(d, 10) : d.endsWith('x') ? parseFloat(d) * 1000 : 1
      return { u: bits[0], w: Number.isNaN(w) ? 1 : w }
    })
    .filter((c) => c.u && !c.u.startsWith('data:'))
  cands.sort((a, b) => b.w - a.w)
  return cands[0]?.u || ''
}

/** Noscript/JS-fallback placeholder <img>s that sites hide once scripts run (e.g. BBC's grey spacer). */
function isNoscriptImg(img: any): boolean {
  return (
    /hide-when-no-script|no-?script/i.test(img.getAttribute('class') || '') ||
    /image unavailable/i.test(img.getAttribute('aria-label') || '')
  )
}

/** The real image URL for an <img>, or '' if it only offers a placeholder. */
function bestImgSrc(img: any): string {
  const parent = img.parentNode
  const sourceSrcset =
    parent && (parent.tagName || '').toUpperCase() === 'PICTURE'
      ? (Array.from(parent.querySelectorAll?.('source') ?? []) as any[])
          .map((s) => s.getAttribute('srcset') || '')
          .filter(Boolean)
          .join(', ')
      : ''
  const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || sourceSrcset
  const candidates = [img.getAttribute('data-src'), srcset ? largestSrc(srcset) : '', img.getAttribute('src')]
  return candidates.find((u) => u && !u.startsWith('data:') && !PLACEHOLDER.test(u)) || ''
}

/**
 * Walk Readability's cleaned article DOM into ordered blocks. Doing this per block —
 * rather than taking `textContent` of the whole thing — is what preserves paragraph
 * breaks and keeps adjacent blocks from gluing together ("…mouth.The incident…").
 */
function structure(contentHtml: string, baseUrl?: string): { text: string; markdown: string } {
  const { document } = parseHTML(`<div id="__root">${contentHtml}</div>`)
  const root = document.getElementById('__root')
  const md: string[] = []
  const plain: string[] = []

  const resolve = (src: string) => {
    if (!baseUrl) return src
    try {
      return new URL(src, baseUrl).href
    } catch {
      return src
    }
  }
  const inline = (el: any): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

  // Emit the first real image among candidates (sites render a hidden placeholder <img>
  // right next to the real one). Returns true once a real image is pushed.
  const pushImg = (imgs: any[], caption = ''): boolean => {
    for (const img of imgs) {
      if (isNoscriptImg(img)) continue
      const chosen = bestImgSrc(img)
      if (!chosen) continue
      const alt = (img.getAttribute('alt') || caption || '').replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim()
      md.push(`![${alt}](${resolve(chosen)})`)
      return true
    }
    return false
  }
  const imgsIn = (el: any): any[] => Array.from(el.querySelectorAll?.('img') ?? []) as any[]

  const walk = (node: any) => {
    for (const child of Array.from(node.childNodes) as any[]) {
      const tag = (child.tagName as string | undefined)?.toUpperCase()
      if (!tag) continue

      if (tag === 'FIGURE') {
        const cap = child.querySelector?.('figcaption')
        pushImg(imgsIn(child), cap ? inline(cap) : '')
        continue
      }
      if (tag === 'IMG') {
        pushImg([child])
        continue
      }
      if (tag === 'UL' || tag === 'OL') {
        const items = (Array.from(child.querySelectorAll?.('li') ?? []) as any[]).map(inline).filter(Boolean)
        if (items.length) {
          md.push(items.map((i) => `- ${i}`).join('\n'))
          plain.push(items.map((i) => `• ${i}`).join('\n'))
        }
        continue
      }
      if (tag === 'BLOCKQUOTE') {
        const q = inline(child)
        if (q) {
          md.push(`> ${q}`)
          plain.push(q)
        }
        continue
      }
      if (/^H[1-6]$/.test(tag)) {
        const txt = inline(child)
        if (txt) {
          const lvl = Math.min(Number(tag[1]) + 1, 6) // shift down; the reader renders the title as h1
          md.push(`${'#'.repeat(lvl)} ${txt}`)
          plain.push(txt)
        }
        continue
      }
      if (tag === 'PRE') {
        const code = (child.textContent ?? '').replace(/\n+$/, '')
        if (code.trim()) {
          md.push('```\n' + code + '\n```')
          plain.push(code)
        }
        continue
      }
      if (tag === 'P') {
        const txt = inline(child)
        if (txt) {
          md.push(txt)
          plain.push(txt)
        } else {
          pushImg(imgsIn(child))
        }
        continue
      }
      // container element (div/section/article/…) — descend into it
      walk(child)
    }
  }

  if (root) walk(root)
  return { text: plain.join('\n\n'), markdown: md.join('\n\n') }
}

export function extractArticle(html: string, baseUrl?: string): Extracted {
  const { document } = parseHTML(html)

  // read the social hero before Readability mutates the document
  const ogImage =
    document.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
    document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
    null

  let title: string | null = null
  let text = ''
  let markdown = ''
  let excerpt: string | null = null

  try {
    // Readability expects a DOM Document; linkedom's is compatible at runtime.
    const article = new Readability(document as unknown as Document).parse()
    if (article) {
      title = article.title ?? null
      excerpt = article.excerpt ?? null
      if (article.content) {
        const s = structure(article.content, baseUrl)
        text = s.text
        markdown = s.markdown
      }
      // last resort if the structured walk produced nothing usable
      if (!text) text = (article.textContent ?? '').replace(/\s+\n/g, '\n').trim()
    }
  } catch {
    // Fall back to raw body text below.
  }

  if (!text) {
    text = (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
  if (!markdown) markdown = text
  // if the article body yielded no image, lead with the social hero so there's still a picture
  if (ogImage && !/!\[[^\]]*\]\(/.test(markdown)) {
    let abs = ogImage
    if (baseUrl) {
      try {
        abs = new URL(ogImage, baseUrl).href
      } catch {
        // keep ogImage as-is
      }
    }
    markdown = markdown ? `![](${abs})\n\n${markdown}` : `![](${abs})`
  }
  if (!title) {
    title = document.querySelector('title')?.textContent?.trim() ?? null
  }

  return { title, text, markdown, excerpt }
}
