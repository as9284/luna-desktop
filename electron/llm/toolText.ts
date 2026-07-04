import type { ToolCall } from './config'

/**
 * Rescue tool calls that a model emits as TEXT instead of as native structured calls, strip
 * reasoning that models leak inline, and shape the tool-call round-trip so a model that doesn't
 * do native tool calling can still follow a multi-step chain.
 *
 * Weaker / open models don't reliably return OpenAI `tool_calls` / Anthropic `tool_use` blocks
 * even when tools are offered. Instead they write the call out as plain text, in one of several
 * dialects:
 *
 *   Anthropic dialect:
 *     <function_calls>
 *     <invoke name="web_search">
 *     <parameter name="query" string="true">turkey smartphone customs 2025</parameter>
 *     </invoke>
 *     </function_calls>
 *
 *   DeepSeek "DSML" dialect (uses U+FF5C fullwidth bars ｜ as anti-detection):
 *     <｜｜DSML｜｜tool_calls>
 *     <｜｜DSML｜｜invoke name="write_file">
 *     <｜｜DSML｜｜parameter name="content" string="true">…</｜｜DSML｜｜parameter>
 *     </｜｜DSML｜｜invoke>
 *     </｜｜DSML｜｜tool_calls>
 *
 *   Hermes / Qwen dialect (JSON inside <tool_call> tags, one block per call):
 *     <tool_call>{"name": "web_search", "arguments": {"query": "…"}}</tool_call>
 *
 *   Mistral dialect (a JSON array after a literal marker):
 *     [TOOL_CALLS][{"name": "web_search", "arguments": {"query": "…"}}]
 *
 * Left untouched that text streams straight into the chat as visible words. This module (a)
 * parses such a block back into real ToolCalls so the normal tool loop can execute them, (b)
 * gives a streaming filter that keeps the block — and any inline <think> reasoning — from ever
 * reaching the renderer as it types, and (c) builds the assistant/observation turns that feed a
 * text-dialect tool result back in a shape the model will actually continue from.
 *
 * Pure and Electron-free so it runs under `tsx` (see scripts/test-llm.mts).
 */

/**
 * The opening marker of a text tool-call block, per dialect. The filter/parser scan for the
 * EARLIEST match across all of them. Each entry is the marker without its closing delimiter, so
 * a block that opens with attributes (`<function_calls antml:prefix="…">`) is still caught.
 *
 * `｜` below is U+FF5C (fullwidth vertical bar), not ASCII `|` — that's how DeepSeek emits it.
 */
export const OPENERS = ['<function_calls', '<｜｜DSML｜｜tool_calls', '<tool_call', '[TOOL_CALLS]'] as const

/** Reasoning wrappers some models leak inline in `content` (local r1 distills, etc.). */
const THINK_OPEN = ['<think>', '<thinking>'] as const
const THINK_CLOSE = ['</think>', '</thinking>'] as const

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
 * Across every marker, the longest trailing hold-back of `s` that could be the start of any
 * marker split across a chunk boundary. We take the max so a split marker of any dialect is
 * kept out of the live stream until it resolves.
 */
export function partialMarkerTail(s: string, markers: readonly string[] = OPENERS): number {
  let best = 0
  for (const m of markers) {
    const k = tailForMarker(s, m)
    if (k > best) best = k
  }
  return best
}

/** Earliest index of any marker in `s` and which one matched, or idx -1 when none is present. */
function firstMarker(s: string, markers: readonly string[]): { idx: number; marker: string } {
  let idx = -1
  let marker = ''
  for (const m of markers) {
    const i = s.indexOf(m)
    if (i !== -1 && (idx === -1 || i < idx)) {
      idx = i
      marker = m
    }
  }
  return { idx, marker }
}

/** Earliest index of any tool-call opener in `s`, or -1 when none is present. */
function earliestOpener(s: string, markers: readonly string[] = OPENERS): number {
  return firstMarker(s, markers).idx
}

/**
 * Wrap an onDelta sink so text is forwarded live, but two kinds of non-answer text are held out
 * of the stream: everything from the first tool-call opener onward (swallowed to the end, since
 * the block runs to the end of the turn), and everything between a <think>/<thinking> opener and
 * its close (dropped, then normal streaming resumes). Markers split across a chunk boundary are
 * held back until they resolve.
 */
export function makeToolTextFilter(emit: (text: string) => void) {
  let pending = ''
  let stopped = false
  let inThink = false
  return {
    push(chunk: string) {
      if (stopped || !chunk) return
      pending += chunk
      for (;;) {
        if (inThink) {
          const close = firstMarker(pending, THINK_CLOSE)
          if (close.idx !== -1) {
            pending = pending.slice(close.idx + close.marker.length)
            inThink = false
            continue // reprocess the remainder as normal content
          }
          // still reasoning: drop it, but retain a tail that could be a split close marker
          const tail = partialMarkerTail(pending, THINK_CLOSE)
          pending = tail ? pending.slice(pending.length - tail) : ''
          return
        }
        const tool = firstMarker(pending, OPENERS)
        const think = firstMarker(pending, THINK_OPEN)
        if (tool.idx !== -1 && (think.idx === -1 || tool.idx < think.idx)) {
          // a tool block starts here — emit the prose before it, then swallow to the end
          if (tool.idx > 0) emit(pending.slice(0, tool.idx))
          pending = ''
          stopped = true
          return
        }
        if (think.idx !== -1) {
          // a reasoning block starts here — emit the prose before it, drop the marker, keep going
          if (think.idx > 0) emit(pending.slice(0, think.idx))
          pending = pending.slice(think.idx + think.marker.length)
          inThink = true
          continue
        }
        // no full marker present — emit all but a possible split marker prefix
        const tail = partialMarkerTail(pending, [...OPENERS, ...THINK_OPEN])
        if (pending.length > tail) {
          emit(pending.slice(0, pending.length - tail))
          pending = tail ? pending.slice(pending.length - tail) : ''
        }
        return
      }
    },
    /** Emit any withheld tail once the stream ends. Unterminated reasoning is dropped. */
    flush() {
      if (stopped) return
      if (inThink) {
        pending = ''
        return
      }
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

/**
 * Remove reasoning that arrived inline in `content` (paired <think>…</think> / <thinking>…, plus
 * a dangling unclosed opener at the end) so it never lands in the chat history we replay to the
 * model or in the prose we parse tool calls out of. Reasoning delivered on a separate
 * `reasoning_content` field never enters `content`, so it needs no stripping here.
 */
export function stripReasoning(content: string): string {
  return content
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think(?:ing)?>[\s\S]*$/i, '')
    .trim()
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

/** Extract the first complete JSON value ({…} or […]) at the start of `s`, or null if truncated. */
function extractJson(s: string): string | null {
  const t = s.replace(/^\s+/, '')
  const open = t[0]
  if (open !== '{' && open !== '[') return null
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return t.slice(0, i + 1)
    }
  }
  return null // unbalanced — the stream was cut off mid-value
}

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/** Build a ToolCall from a `{name, arguments}`-shaped object (arguments may be object or string). */
function toolCallFromObj(obj: unknown): ToolCall | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name : typeof o.tool === 'string' ? o.tool : ''
  if (!name) return null
  const rawArgs = o.arguments ?? o.parameters ?? o.args ?? {}
  // OpenAI tool_call arguments is a JSON string; keep a provided string, stringify an object.
  const args = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs)
  return { id: uid(), type: 'function', function: { name, arguments: args } }
}

/** Anthropic / DSML XML dialect: <invoke name="…"><parameter name="…">value</parameter></invoke>. */
function parseXmlCalls(region: string): ToolCall[] {
  const calls: ToolCall[] = []
  // Opening tags may carry a DSML prefix (`<｜｜DSML｜｜invoke …>`) or not; closing tags may be
  // plain or DSML-flavored. The `(?:｜｜DSML｜｜)?` optional prefix covers both on each side.
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
  return calls
}

/** Hermes / Qwen dialect: one JSON object per <tool_call>…</tool_call> block. */
function parseHermesCalls(region: string): ToolCall[] {
  const calls: ToolCall[] = []
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(region))) {
    const call = toolCallFromObj(safeJson(m[1]))
    if (call) calls.push(call)
  }
  return calls
}

/** Mistral dialect: a JSON array of {name, arguments} after the literal [TOOL_CALLS] marker. */
function parseMistralCalls(region: string): ToolCall[] {
  const after = region.slice('[TOOL_CALLS]'.length)
  const json = extractJson(after)
  if (!json) return []
  const arr = safeJson(json)
  if (!Array.isArray(arr)) return []
  return arr.map(toolCallFromObj).filter((c): c is ToolCall => c !== null)
}

export interface ParsedToolText {
  /** Assistant prose that preceded the tool block (trailing whitespace trimmed). */
  clean: string
  /** Tool calls parsed from the block — empty when the block is malformed or truncated. */
  calls: ToolCall[]
}

/**
 * Parse a text-format tool-call block out of assistant content, in any supported dialect.
 * Returns null when no opener marker is present at all; otherwise returns the clean prose before
 * it and whatever calls could be parsed (possibly none, if the stream was cut off mid-block).
 *
 * Strip reasoning (stripReasoning) before calling this so a tool block that follows a <think>
 * region is found and the returned `clean` prose carries no reasoning.
 */
export function parseTextToolCalls(content: string): ParsedToolText | null {
  const start = earliestOpener(content)
  if (start === -1) return null
  const clean = content.slice(0, start).replace(/\s+$/, '')
  const region = content.slice(start)
  const calls = region.startsWith('<function_calls') || region.startsWith('<｜｜DSML｜｜tool_calls')
    ? parseXmlCalls(region)
    : region.startsWith('<tool_call')
      ? parseHermesCalls(region)
      : region.startsWith('[TOOL_CALLS]')
        ? parseMistralCalls(region)
        : []
  return { clean, calls }
}

/**
 * The assistant turn to store in history for a text-dialect tool call. We keep the model's prose
 * but drop the raw call block — replaying a model's own tool-call syntax back to it makes weaker
 * models echo the pattern (re-calling the same tool) instead of using the result. If there was
 * no prose (the model emitted only the block), fall back to a neutral note naming the tools, so
 * the turn is non-empty (some endpoints reject empty assistant content, and Anthropic needs a
 * real assistant turn between the user prompt and the observation).
 */
export function textCallAssistantContent(clean: string, calls: ToolCall[]): string {
  if (clean.trim()) return clean
  const names = [...new Set(calls.map((c) => c.function.name))].join(', ')
  return names ? `(Calling ${names}.)` : '(Calling a tool.)'
}

/**
 * The user-role observation turn that carries text-dialect tool results back to the model. A
 * model that doesn't do native tool calling follows a ReAct-style transcript, so results come
 * as a labelled observation plus one steering line — that nudge is what stops weaker models from
 * halting after a single tool call.
 */
export function textCallObservationContent(results: { name: string; result: string }[]): string {
  const body = results.map((r) => `[${r.name} result]\n${r.result}`).join('\n\n')
  return `${body}\n\nContinue based on these results: call another tool if you still need more, otherwise write your final reply to me now.`
}
