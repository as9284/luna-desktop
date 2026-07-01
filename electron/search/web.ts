import { parseHTML } from 'linkedom'
import { fetchHtml } from './http'
import { renderHtml } from './browser'

export interface SearchHit {
  url: string
  title: string
  snippet: string
}

/**
 * The built-in, keyless search: reads DuckDuckGo's no-JS HTML results page and parses
 * the result links — no account, no API key, works on a fresh install.
 *
 * A plain HTTP fetch handles the common case; if DuckDuckGo challenges it (an anomaly
 * page with no result rows), we render it once in the headless browser and re-parse.
 */
const DDG_HTML = 'https://html.duckduckgo.com/html/?q='

export async function searchWeb(query: string, signal: AbortSignal, limit = 6): Promise<SearchHit[]> {
  const url = DDG_HTML + encodeURIComponent(query)

  const res = await fetchHtml(url, signal, 12000)
  let hits = res.ok && res.html ? parseResults(res.html) : []

  if (hits.length === 0) {
    try {
      hits = parseResults(await renderHtml(url, signal, 15000))
    } catch {
      // give up quietly — discover() callers treat an empty list as "no results"
    }
  }

  return hits.slice(0, limit)
}

interface El {
  getAttribute(name: string): string | null
  textContent: string | null
  querySelector(selectors: string): El | null
}

function parseResults(html: string): SearchHit[] {
  const { document } = parseHTML(html)
  const rows = Array.from(document.querySelectorAll('div.result')) as unknown as El[]

  const out: SearchHit[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (row.getAttribute('class')?.includes('result--ad')) continue
    const anchor = row.querySelector('a.result__a')
    const realUrl = resolveUrl(anchor?.getAttribute('href') ?? null)
    if (!realUrl || seen.has(realUrl)) continue
    seen.add(realUrl)

    out.push({
      url: realUrl,
      title: (anchor?.textContent ?? '').trim() || realUrl,
      snippet: (row.querySelector('.result__snippet')?.textContent ?? '').trim(),
    })
  }
  return out
}

/** DuckDuckGo wraps results as `//duckduckgo.com/l/?uddg=<encoded>` — unwrap to the target. */
function resolveUrl(href: string | null): string | null {
  if (!href) return null
  const raw = href.startsWith('//') ? `https:${href}` : href
  try {
    const u = new URL(raw, 'https://duckduckgo.com')
    const uddg = u.searchParams.get('uddg')
    if (uddg) return uddg
    if ((u.protocol === 'https:' || u.protocol === 'http:') && !/(^|\.)duckduckgo\.com$/.test(u.hostname)) {
      return u.toString()
    }
    return null
  } catch {
    return null
  }
}
