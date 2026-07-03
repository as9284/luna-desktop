import type { ToolCall } from './config'

/**
 * Rescue tool calls that a model emits as TEXT instead of as native structured calls.
 *
 * Weaker "flash"-tier models — DeepSeek V4 Flash among them — don't reliably return OpenAI
 * `tool_calls` / Anthropic `tool_use` blocks even when tools are offered. Instead they write
 * the call out as plain text, in the Anthropic function-calling XML dialect:
 *
 *   <function_calls>
 *   <invoke name="web_search">
 *   <parameter name="query" string="true">turkey smartphone customs 2025</parameter>
 *   </invoke>
 *   </function_calls>
 *
 * Left untouched that XML streams straight into the chat as visible words. This module (a)
 * parses such a block back into real ToolCalls so the normal tool loop can execute them, and
 * (b) gives a streaming filter that stops the XML from ever reaching the renderer as it types.
 *
 * Pure and Electron-free so it runs under `tsx` (see scripts/test-llm.mts).
 */

const OPEN = '<function_calls'

const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `ttc-${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Length of the suffix of `s` that is a (non-empty) prefix of `marker` — i.e. how many trailing
 * characters we must withhold because they might be the start of the marker split across chunks.
 */
export function partialMarkerTail(s: string, marker = OPEN): number {
  const max = Math.min(marker.length - 1, s.length)
  for (let k = max; k > 0; k--) {
    if (s.endsWith(marker.slice(0, k))) return k
  }
  return 0
}

/**
 * Wrap an onDelta sink so text is forwarded live, but everything from `<function_calls…` onward
 * is swallowed. A partial marker landing on a chunk boundary is held back until it resolves.
 */
export function makeToolTextFilter(emit: (text: string) => void) {
  let pending = ''
  let stopped = false
  return {
    push(chunk: string) {
      if (stopped || !chunk) return
      pending += chunk
      const idx = pending.indexOf(OPEN)
      if (idx !== -1) {
        if (idx > 0) emit(pending.slice(0, idx))
        pending = ''
        stopped = true
        return
      }
      const tail = partialMarkerTail(pending)
      if (pending.length > tail) {
        emit(pending.slice(0, pending.length - tail))
        pending = tail ? pending.slice(pending.length - tail) : ''
      }
    },
    /** Emit any withheld tail once the stream ends without a tool block. No-op once stopped. */
    flush() {
      if (stopped) return
      if (pending) {
        emit(pending)
        pending = ''
      }
    },
    get stopped() {
      return stopped
    },
  }
}

/** Coerce a `<parameter>` inner value using its type hint (e.g. `string="true"`, `integer="true"`). */
function coerceParam(raw: string, attrs: string): unknown {
  const t = /\b(string|integer|number|float|boolean|bool|array|object|json|null)\s*=\s*"true"/i
    .exec(attrs)?.[1]
    ?.toLowerCase()
  const v = raw.trim()
  try {
    switch (t) {
      case 'integer':
      case 'number':
      case 'float': {
        const n = Number(v)
        return Number.isNaN(n) ? v : n
      }
      case 'boolean':
      case 'bool':
        return v === 'true' ? true : v === 'false' ? false : v
      case 'array':
      case 'object':
      case 'json':
        return JSON.parse(v)
      case 'null':
        return null
      default:
        return v
    }
  } catch {
    return v
  }
}

export interface ParsedToolText {
  /** Assistant prose that preceded the tool block (trailing whitespace trimmed). */
  clean: string
  /** Tool calls parsed from the block — empty when the block is malformed or truncated. */
  calls: ToolCall[]
}

/**
 * Parse a text-format tool-call block out of assistant content. Returns null when no
 * `<function_calls` marker is present at all; otherwise returns the clean prose before it and
 * whatever invokes could be parsed (possibly none, if the stream was cut off mid-block).
 */
export function parseTextToolCalls(content: string): ParsedToolText | null {
  const start = content.indexOf(OPEN)
  if (start === -1) return null
  const clean = content.slice(0, start).replace(/\s+$/, '')
  const region = content.slice(start)
  const calls: ToolCall[] = []

  const invokeRe = /<invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/invoke>/g
  let inv: RegExpExecArray | null
  while ((inv = invokeRe.exec(region))) {
    const name = inv[1]
    const body = inv[2]
    const args: Record<string, unknown> = {}
    const paramRe = /<parameter\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/parameter>/g
    let p: RegExpExecArray | null
    while ((p = paramRe.exec(body))) args[p[1]] = coerceParam(p[3], p[2] || '')
    calls.push({ id: uid(), type: 'function', function: { name, arguments: JSON.stringify(args) } })
  }

  return { clean, calls }
}
