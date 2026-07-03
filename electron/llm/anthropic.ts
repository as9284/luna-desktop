import { readEventStream } from './sse'
import { endpointOf, type ChatMsg, type ContentPart, type ModelConfig, type StreamResult, type ToolCall, type ToolDef } from './config'

/**
 * Anthropic-compatible adapter (the Messages API). Translates the internal OpenAI-shaped
 * conversation to Anthropic's shape on the way in, and Anthropic's streamed content blocks /
 * tool_use back to the internal StreamResult on the way out — so the chat loop stays
 * protocol-agnostic.
 */

const MAX_TOKENS = 4096
const ANTHROPIC_VERSION = '2023-06-01'

const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s || '{}')
  } catch {
    return {}
  }
}
const asText = (content: ChatMsg['content']): string =>
  content == null ? '' : typeof content === 'string' ? content : (content as ContentPart[]).filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('')

function toAnthropicContent(content: ChatMsg['content']): unknown {
  if (content == null) return ''
  if (typeof content === 'string') return content
  return (content as ContentPart[]).map((p) =>
    p.type === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.dataBase64 } }
      : { type: 'text', text: p.text },
  )
}

interface AntMsg { role: 'user' | 'assistant'; content: unknown }

/** OpenAI-shaped convo → { system, messages } for Anthropic. */
export function toAnthropic(convo: ChatMsg[]): { system: string; messages: AntMsg[] } {
  let system = ''
  const messages: AntMsg[] = []

  for (const m of convo) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + asText(m.content)
      continue
    }
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: asText(m.content) }
      const last = messages[messages.length - 1]
      // fold consecutive tool results into one user turn (Anthropic requires them together)
      if (last && last.role === 'user' && Array.isArray(last.content) && (last.content as { type: string }[]).every((c) => c.type === 'tool_result')) {
        ;(last.content as unknown[]).push(block)
      } else {
        messages.push({ role: 'user', content: [block] })
      }
      continue
    }
    if (m.role === 'assistant') {
      if (m.tool_calls?.length) {
        const content: unknown[] = []
        const t = asText(m.content)
        if (t) content.push({ type: 'text', text: t })
        for (const tc of m.tool_calls) content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: safeParse(tc.function.arguments) })
        messages.push({ role: 'assistant', content })
      } else {
        messages.push({ role: 'assistant', content: toAnthropicContent(m.content) })
      }
      continue
    }
    // user (or any other role) → user turn
    messages.push({ role: 'user', content: toAnthropicContent(m.content) })
  }
  return { system, messages }
}

const toAnthropicTools = (tools?: ToolDef[]) =>
  tools?.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }))

// Anthropic caps temperature at 1.0 (OpenAI allows up to 2)
const clampTemp = (t?: number) => Math.max(0, Math.min(1, t ?? 0.7))

async function post(cfg: ModelConfig, key: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(endpointOf(cfg), {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}: ${text.slice(0, 300) || res.statusText}`)
  }
  return res
}

export async function streamAnthropic(
  cfg: ModelConfig,
  key: string,
  convo: ChatMsg[],
  opts: { temperature?: number; tools?: ToolDef[]; signal?: AbortSignal },
  onDelta: (text: string) => void,
): Promise<StreamResult> {
  const { system, messages } = toAnthropic(convo)
  const res = await post(
    cfg,
    key,
    {
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      stream: true,
      temperature: clampTemp(opts.temperature),
      ...(system ? { system } : {}),
      messages,
      ...(opts.tools?.length ? { tools: toAnthropicTools(opts.tools) } : {}),
    },
    opts.signal,
  )

  let content = ''
  let finishReason: string | null = null
  const byIndex = new Map<number, ToolCall>() // content-block index → accumulating tool call

  await readEventStream(res, (data) => {
    try {
      const ev = JSON.parse(data)
      switch (ev.type) {
        case 'content_block_start': {
          if (ev.content_block?.type === 'tool_use') {
            byIndex.set(ev.index, { id: ev.content_block.id, type: 'function', function: { name: ev.content_block.name, arguments: '' } })
          }
          break
        }
        case 'content_block_delta': {
          if (ev.delta?.type === 'text_delta' && ev.delta.text) {
            content += ev.delta.text
            onDelta(ev.delta.text)
          } else if (ev.delta?.type === 'input_json_delta') {
            const call = byIndex.get(ev.index)
            if (call) call.function.arguments += ev.delta.partial_json ?? ''
          }
          break
        }
        case 'message_delta': {
          const stop = ev.delta?.stop_reason
          if (stop) finishReason = stop === 'tool_use' ? 'tool_calls' : stop === 'end_turn' ? 'stop' : stop
          break
        }
      }
    } catch {
      // partial / non-JSON frame (e.g. ping) — ignore
    }
  })

  // order tool calls by their content-block index
  const toolCalls = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)
  if (toolCalls.length && !finishReason) finishReason = 'tool_calls'
  return { content, toolCalls, finishReason }
}

export async function completeAnthropic(
  cfg: ModelConfig,
  key: string,
  convo: ChatMsg[],
  opts: { temperature?: number; signal?: AbortSignal },
): Promise<string> {
  const { system, messages } = toAnthropic(convo)
  const res = await post(
    cfg,
    key,
    {
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      stream: false,
      temperature: clampTemp(opts.temperature),
      ...(system ? { system } : {}),
      messages,
    },
    opts.signal,
  )
  const data = await res.json()
  const blocks = Array.isArray(data.content) ? data.content : []
  return blocks.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
}
