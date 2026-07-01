import { USER_AGENT, ACCEPT_HTML } from './constants'

export interface HttpResult {
  ok: boolean
  html?: string
  finalUrl?: string
  status?: number
  error?: string
}

const MAX_HTML_BYTES = 5_000_000

/** Tier 1: a plain, polite HTTP fetch with a UA, timeout, and content-type guard. */
export async function fetchHtml(url: string, signal: AbortSignal, timeoutMs = 15000): Promise<HttpResult> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: ACCEPT_HTML },
    })
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` }

    const contentType = res.headers.get('content-type') ?? ''
    if (!/html|xml|text/i.test(contentType)) {
      return { ok: false, status: res.status, error: `non-HTML content-type: ${contentType}` }
    }

    const html = (await res.text()).slice(0, MAX_HTML_BYTES)
    return { ok: true, html, finalUrl: res.url, status: res.status }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}
