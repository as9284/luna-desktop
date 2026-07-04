import type { ToolCall } from './config'

/**
 * Rescue tool calls that a model emits as TEXT instead of as native structured calls.
 *
 * Weaker "flash"-tier models — DeepSeek V4 Flash among them — don't reliably return OpenAI
 * `tool_calls` / Anthropic `tool_use` blocks even when tools are offered. Instead they write
 * the call out as plain text, in one of several function-calling XML dialects:
 *
 *   Anthropic dialect:
 *     <function_calls>
 *     <invoke name="web_search">
 *     <parameter name="query" string="true">turkey smartphone customs 2025</parameter>
 *     </invoke>
 *     </function_calls>
 *
 *   DeepSeek V4 "DSML" dialect (uses U+FF5C fullwidth bars ｜ as anti-detection):
 *     <｜｜DSML｜｜tool_calls>
 *     <｜｜DSML｜｜invoke name="write_file">
 *     <｜｜DSML｜｜parameter name="content" string="true">…</｜｜DSML｜｜parameter>
 *     </｜｜DSML｜｜invoke>
 *     </｜｜DSML｜｜tool_calls>
 *
 * Left untouched that XML streams straight into the chat as visible words. This module (a)
 * parses such a block back into real ToolCalls so the normal tool loop can execute them, and
 * (b) gives a streaming filter that stops the XML from ever reaching the renderer as it types.
 *
 * Pure and Electron-free so it runs under `tsx` (see scripts/test-llm.mts).
 */

/**
 * The opening marker of a text tool-call block, per dialect. The filter/parser scan for the
 * EARLIEST match across all of them. Each entry is the marker without its closing `>`, so a
 * block that opens with `<function_calls antml:prefix="…">` (attributes on the opener) is
 * still caught.
 *
 * `｜` below is U+FF5C (fullwidth vertical bar), not ASCII `|` — that's how DeepSeek emits it.
 */
export const OPENERS = ['<function_calls', '<｜｜DSML｜｜tool_calls'] as const

const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `ttc-${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Length of the suffix of `s` that is a (non-empty) prefix of `marker` — i.e. how many trailing
 * characters we must withhold because they might be the start of the marker split across chunks.
 */
function tailForMarker(s: string, marker: string): number {
  const max = Math.min(marker.length - 1, s.length)
  for (let k = max; k > 0; k--) {
    if (s.endsWith(marker.slice(0, k))) return k
  }
  return 0
}

/**
 * Across every dialect opener, the longest trailing hold-back of `s` that could be the start
 * of any marker split across a chunk boundary. We take the max so a split opener of any dialect
 * is kept out of the live stream until it resolves.
 */
export function partialMarkerTail(s: string, markers: readonly string[] = OPENERS): number {
  let best = 0
  for (const m of markers) {
    const k = tailForMarker(s, m)
    if (k > best) best = k
  }
  return best
}

/** Earliest index of any dialect opener in `s`, or -1 when none is present. */
function earliestOpener(s: string, markers: readonly string[] = OPENERS): number {
  let idx = -1
  for (const m of markers) {
    const i = s.indexOf(m)
    if (i !== -1 && (idx === -1 || i < idx)) idx = i
  }
  return idx
}

/**
 * Wrap an onDelta sink so text is forwarded live, but everything from the first dialect opener
 * onward is swallowed. A partial marker landing on a chunk boundary is held back until it
 * resolves into a real opener (then suppressed) or unrelated text (then flushed).
 */
export function makeToolTextFilter(emit: (text: string) => void) {
  let pending = ''
  let stopped = false
  return {
    push(chunk: string) {
      if (stopped || !chunk) return
      pending += chunk
      const idx = earliestOpener(pending)
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
 * Parse a text-format tool-call block out of assistant content, in any supported dialect.
 * Returns null when no opener marker is present at all; otherwise returns the clean prose
 * before it and whatever invokes could be parsed (possibly none, if the stream was cut off
 * mid-block).
 *
 * The `<invoke>` / `<parameter>` bodies are dialect-agnostic — both the Anthropic and DSML
 * dialects use the same element names for the inner structure (only the opener differs), and
 * the close tags in observed DSML output are standard `</invoke>` / `</parameter>`. We tolerate
 * a DSML-flavored close (`</｜｜DSML｜｜parameter>`) defensively in case a model emits it.
 */
export function parseTextToolCalls(content: string): ParsedToolText | null {
  const start = earliestOpener(content)
  if (start === -1) return null
  const clean = content.slice(0, start).replace(/\s+$/, '')
  const region = content.slice(start)
  const calls: ToolCall[] = []

  // Opening tags may carry a DSML prefix (`<｜｜DSML｜｜invoke …>`) or not (`<invoke …>`);
  // closing tags may be `</invoke>` or `</｜｜DSML｜｜invoke>`. The `(?:｜｜DSML｜｜)?`
  // optional prefix covers both dialects on the way in, and the alternation covers the close.
  const invokeRe = /<(?:｜｜DSML｜｜)?invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/(?:｜｜DSML｜｜)?invoke>/g
  let inv: RegExpExecArray | null
  while ((inv = invokeRe.exec(region))) {
    const name = inv[1]
    const body = inv[2]
    const args: Record<string, unknown> = {}
    const paramRe = /<(?:｜｜DSML｜｜)?parameter\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/(?:｜｜DSML｜｜)?parameter>/g
    let p: RegExpExecArray | null
    while ((p = paramRe.exec(body))) args[p[1]] = coerceParam(p[3], p[2] || '')
    calls.push({ id: uid(), type: 'function', function: { name, arguments: JSON.stringify(args) } })
  }

  return { clean, calls }
}