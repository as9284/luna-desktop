import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'

export interface Extracted {
  title: string | null
  text: string
  excerpt: string | null
}

export function extractArticle(html: string): Extracted {
  const { document } = parseHTML(html)

  let title: string | null = null
  let text = ''
  let excerpt: string | null = null

  try {
    // Readability expects a DOM Document; linkedom's is compatible at runtime.
    const article = new Readability(document as unknown as Document).parse()
    if (article) {
      title = article.title ?? null
      text = (article.textContent ?? '').replace(/\s+\n/g, '\n').trim()
      excerpt = article.excerpt ?? null
    }
  } catch {
    // Fall back to raw body text below.
  }

  if (!text) {
    text = (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
  if (!title) {
    title = document.querySelector('title')?.textContent?.trim() ?? null
  }

  return { title, text, excerpt }
}
