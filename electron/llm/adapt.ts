/**
 * Defensive request adaptation for endpoints that reject an otherwise-valid request. Some
 * OpenAI-compatible models 400 on parameters they don't implement — o1/o3 reject `temperature`,
 * a few reject `tools`, and some local/proxied models reject a `system` role. Rather than surface
 * a raw 400, we read the error, drop or reshape the offending piece, and retry; the learned
 * repair is cached per model for the session so later requests skip the failing round-trip.
 *
 * Pure logic (diagnose / applyRepair / foldSystemMessages) is Electron-free and unit-tested;
 * adaptivePost wires it around fetch. See scripts/test-llm.mts.
 */

export type Repair = 'dropTemperature' | 'dropTools' | 'foldSystem'

interface Msg {
  role: string
  content: unknown
  [k: string]: unknown
}

/**
 * Name the single repair most likely to fix a 400, or null when the error isn't one we know how
 * to adapt to. `applied` guards against re-picking a repair that already didn't help, so the
 * retry loop always terminates.
 */
export function diagnoseRepair(status: number, errorText: string, applied: ReadonlySet<Repair>): Repair | null {
  if (status !== 400) return null
  const t = errorText.toLowerCase()
  const rejected = /unsupported|not support|does ?n['o]t support|only.*(support|default)|invalid|unexpected|unknown|not allowed|cannot|must not|no longer/
  if (!applied.has('dropTemperature') && /temperature/.test(t)) return 'dropTemperature'
  if (!applied.has('foldSystem') && /system/.test(t) && /role|message|prompt|not support|unsupported/.test(t)) return 'foldSystem'
  if (!applied.has('dropTools') && /\btool|function[_ ]?call/.test(t) && rejected.test(t)) return 'dropTools'
  return null
}

const asText = (content: unknown): string =>
  content == null
    ? ''
    : typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).join('')
        : String(content)

/** Merge every `system` message's text into the first user message, dropping the system role. */
export function foldSystemMessages(messages: Msg[]): Msg[] {
  const sys = messages.filter((m) => m.role === 'system').map((m) => asText(m.content)).filter(Boolean).join('\n\n')
  if (!sys) return messages
  const rest = messages.filter((m) => m.role !== 'system')
  const i = rest.findIndex((m) => m.role === 'user')
  if (i === -1) return [{ role: 'user', content: sys }, ...rest]
  const target = rest[i]
  // preserve array (multimodal) content by prepending a text part; otherwise concatenate strings
  const merged: Msg = Array.isArray(target.content)
    ? { ...target, content: [{ type: 'text', text: sys }, ...(target.content as unknown[])] }
    : { ...target, content: `${sys}\n\n${asText(target.content)}` }
  return [...rest.slice(0, i), merged, ...rest.slice(i + 1)]
}

/** Apply one repair to a request body, returning a new body (never mutates the input). */
export function applyRepair(body: Record<string, unknown>, repair: Repair): Record<string, unknown> {
  const next = { ...body }
  if (repair === 'dropTemperature') delete next.temperature
  else if (repair === 'dropTools') {
    delete next.tools
    delete next.tool_choice
  } else if (repair === 'foldSystem' && Array.isArray(next.messages)) {
    next.messages = foldSystemMessages(next.messages as Msg[])
  }
  return next
}

const repairCache = new Map<string, Set<Repair>>()

/**
 * POST a request body, adapting to a 400 the endpoint returns for an unsupported parameter/role
 * and retrying. Repairs learned for a (baseUrl+model) key are pre-applied to later requests.
 * Throws the provider error when the 400 isn't one we can adapt to, matching the adapters' raw
 * `${status}: ${body}` error shape.
 */
export async function adaptivePost(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  cacheKey: string,
  signal?: AbortSignal,
): Promise<Response> {
  const applied = repairCache.get(cacheKey) ?? new Set<Repair>()
  let current = body
  for (const r of applied) current = applyRepair(current, r)

  // one attempt per possible repair, plus the initial try
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(current),
    })
    if (res.ok) return res
    const text = await res.text().catch(() => '')
    const repair = diagnoseRepair(res.status, text, applied)
    if (!repair) throw new Error(`${res.status}: ${text.slice(0, 300) || res.statusText}`)
    applied.add(repair)
    repairCache.set(cacheKey, applied)
    current = applyRepair(current, repair)
  }
  throw new Error('Request failed after adapting to the endpoint.')
}

/** Test-only: clear the per-model repair cache between cases. */
export function _resetRepairCache() {
  repairCache.clear()
}
