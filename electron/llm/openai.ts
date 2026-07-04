import { readEventStream } from './sse'
import { adaptivePost } from './adapt'
import { endpointOf, type ChatMsg, type ContentPart, type ModelConfig, type StreamResult, type ToolCall, type ToolDef } from './config'

/** OpenAI-compatible adapter (OpenAI, DeepSeek, OpenRouter, Together, Ollama, LM Studio, …). */

function toContent(content: ChatMsg['content']): unknown {
  if (content == null || typeof content === 'string') return content
  return (content as ContentPart[]).map((p) =>
    p.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.dataBase64}` } }
      : { type: 'text', text: p.text },
  )
}

function toMessages(convo: ChatMsg[]): unknown[] {
  return convo.map((m) => {
    const out: Record<string, unknown> = { role: m.role, content: toContent(m.content) }
    if (m.tool_calls) out.tool_calls = m.tool_calls
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id
    if (m.name) out.name = m.name
    return out
  })
}

function post(cfg: ModelConfig, key: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return adaptivePost(endpointOf(cfg), { Authorization: `Bearer ${key}` }, body, `${cfg.baseUrl}::${cfg.model}`, signal)
}

function mergeToolCallDelta(
  acc: ToolCall[],
  deltas: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[],
) {
  for (const d of deltas) {
    const idx = d.index ?? 0
    if (!acc[idx]) acc[idx] = { id: d.id ?? '', type: 'function', function: { name: '', arguments: '' } }
    if (d.id) acc[idx].id = d.id
    if (d.function?.name) acc[idx].function.name = d.function.name
    if (d.function?.arguments) acc[idx].function.arguments += d.function.arguments
  }
}

export async function streamOpenAI(
  cfg: ModelConfig,
  key: string,
  convo: ChatMsg[],
  opts: { temperature?: number; tools?: ToolDef[]; signal?: AbortSignal },
  onDelta: (text: string) => void,
): Promise<StreamResult> {
  const res = await post(
    cfg,
    key,
    {
      model: cfg.model,
      messages: toMessages(convo),
      stream: true,
      temperature: opts.temperature ?? 0.7,
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
    },
    opts.signal,
  )

  let content = ''
  const toolCalls: ToolCall[] = []
  let finishReason: string | null = null

  await readEventStream(res, (data) => {
    if (data === '[DONE]') return
    try {
      const json = JSON.parse(data)
      const choice = json.choices?.[0]
      const delta = choice?.delta
      if (delta?.content) {
        content += delta.content
        onDelta(delta.content)
      }
      if (delta?.tool_calls) mergeToolCallDelta(toolCalls, delta.tool_calls)
      if (choice?.finish_reason) finishReason = choice.finish_reason
    } catch {
      // partial SSE frame — wait for more
    }
  })

  // Some providers stream native tool_calls without ids. An empty id can't be matched to its
  // tool result, so a model ignores the result (or loops). Synthesize stable, unique ids.
  toolCalls.forEach((c, i) => {
    if (!c.id) c.id = `call_${i}`
  })

  return { content, toolCalls, finishReason }
}

export async function completeOpenAI(
  cfg: ModelConfig,
  key: string,
  convo: ChatMsg[],
  opts: { temperature?: number; signal?: AbortSignal },
): Promise<string> {
  const res = await post(
    cfg,
    key,
    { model: cfg.model, messages: toMessages(convo), stream: false, temperature: opts.temperature ?? 0.5 },
    opts.signal,
  )
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}
