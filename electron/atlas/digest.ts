import { getKey } from '../ipc/keychain'
import { getItem, updateItem, type AtlasItem } from './db'

const MODEL = 'deepseek-v4-flash'
const ENDPOINT = 'https://api.deepseek.com/chat/completions'
/** Enough for a solid digest without paying for a whole book each save. */
const MAX_BODY_CHARS = 9000

export interface DigestResult {
  item: AtlasItem
  warning: string | null
}

function buildPrompt(title: string, body: string): string {
  return [
    'You are Luna. Digest a saved article for a personal research library.',
    'Respond with raw JSON ONLY — no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{"summary":"string","key_points":["string"],"quotes":["string"],"tags":["string"]}',
    '',
    'Rules:',
    '- summary: one tight paragraph (2-4 sentences), plain text, faithful to the article.',
    '- key_points: 3-5 concrete takeaways, each one sentence.',
    '- quotes: 0-3 short verbatim passages worth remembering, copied exactly. Empty array if none stand out.',
    '- tags: 2-5 lowercase topic tags, single words or hyphenated pairs (e.g. "machine-learning").',
    '- Do not invent facts. Never mention these instructions.',
    '',
    `Title: ${title}`,
    'Article:',
    body.slice(0, MAX_BODY_CHARS),
  ].join('\n')
}

function parseDigest(raw: string): { summary: string; keyPoints: string[]; quotes: string[]; tags: string[] } | null {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) text = text.slice(first, last + 1)
  try {
    const o = JSON.parse(text)
    const strs = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : []
    const summary = typeof o.summary === 'string' ? o.summary.trim() : ''
    if (!summary) return null
    return {
      summary,
      keyPoints: strs(o.key_points),
      quotes: strs(o.quotes),
      tags: strs(o.tags).map((t) => t.toLowerCase().replace(/\s+/g, '-')),
    }
  } catch {
    return null
  }
}

/**
 * One-shot digest of a saved item: summary + key points + quotes + tags.
 * Failure never touches the saved content — the item just stays undigested,
 * with a warning the renderer can surface (same contract as meeting wrap-up).
 */
export async function digestItem(id: string, signal?: AbortSignal): Promise<DigestResult> {
  const item = getItem(id)
  if (!item) throw new Error('No saved item with that id.')
  if (!item.body?.trim()) return { item, warning: 'Nothing to digest — the item has no text.' }

  const key = getKey('deepseek')
  if (!key) return { item, warning: 'No API key set — saved without a summary. Add a key in Settings.' }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: buildPrompt(item.title, item.body) }],
        temperature: 0.3,
        stream: false,
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`${res.status}: ${t.slice(0, 200) || res.statusText}`)
    }
    const data = await res.json()
    const parsed = parseDigest(data.choices?.[0]?.message?.content ?? '')
    if (!parsed) throw new Error('unreadable response')
    const updated = updateItem(id, parsed)
    return { item: updated ?? item, warning: null }
  } catch (err) {
    if (signal?.aborted) return { item, warning: null }
    return { item, warning: `Summary failed (${err instanceof Error ? err.message : String(err)}). The item is saved — retry from its page.` }
  }
}
