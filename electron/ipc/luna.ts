import { ipcMain, type IpcMainEvent } from 'electron'
import { getKey } from './keychain'
import { runWebSearch } from '../search'

const MODEL = 'deepseek-v4-flash'
const ENDPOINT = 'https://api.deepseek.com/chat/completions'
/** Tool-call round trips before forcing a final answer without tools — guards against loops. */
const MAX_ROUNDS = 3

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
interface ChatMsg {
  role: string
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

interface ChatRequest {
  id: string
  messages: { role: string; content: string }[]
  temperature?: number
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the live web and read the top results. Use this proactively, without asking permission, whenever the user asks about something recent, time-sensitive, or specific enough that your own knowledge could be wrong or out of date.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'A concise web search query' } },
        required: ['query'],
      },
    },
  },
]

export function registerLuna() {
  ipcMain.on('luna:chat', async (e, req: ChatRequest) => {
    const { id, messages, temperature } = req
    const chunkCh = `luna:chunk:${id}`
    const statusCh = `luna:status:${id}`
    const doneCh = `luna:done:${id}`
    const errCh = `luna:err:${id}`

    const key = getKey('deepseek')
    if (!key) {
      e.sender.send(errCh, 'No DeepSeek API key. Add one in Settings.')
      return
    }

    const signal = new AbortController().signal
    const convo: ChatMsg[] = messages.map((m) => ({ role: m.role, content: m.content }))

    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const withTools = round < MAX_ROUNDS
        const { content, toolCalls, finishReason } = await streamOnce(convo, key, temperature, withTools, e, chunkCh, signal)

        if (finishReason === 'tool_calls' && toolCalls.length) {
          e.sender.send(statusCh, 'Searching the web…')
          convo.push({ role: 'assistant', content: content || null, tool_calls: toolCalls })
          for (const call of toolCalls) {
            let query = ''
            try {
              query = JSON.parse(call.function.arguments || '{}').query ?? ''
            } catch {
              // malformed arguments — treat as empty query below
            }
            const result = query
              ? await runWebSearch(query, signal).catch(
                  (err) => `Search failed: ${err instanceof Error ? err.message : String(err)}`,
                )
              : 'No query provided.'
            convo.push({ role: 'tool', tool_call_id: call.id, content: result })
          }
          e.sender.send(statusCh, null)
          continue
        }

        break
      }
      e.sender.send(doneCh)
    } catch (error) {
      e.sender.send(errCh, error instanceof Error ? error.message : String(error))
    }
  })
}

async function streamOnce(
  convo: ChatMsg[],
  key: string,
  temperature: number | undefined,
  withTools: boolean,
  e: IpcMainEvent,
  chunkCh: string,
  signal: AbortSignal,
): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string | null }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: convo,
      stream: true,
      temperature: temperature ?? 0.7,
      ...(withTools ? { tools: TOOLS } : {}),
    }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 300) || res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let content = ''
  const toolCalls: ToolCall[] = []
  let finishReason: string | null = null

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const l = line.trim()
      if (!l.startsWith('data:')) continue
      const data = l.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const choice = json.choices?.[0]
        const delta = choice?.delta
        if (delta?.content) {
          content += delta.content
          e.sender.send(chunkCh, delta.content)
        }
        if (delta?.tool_calls) mergeToolCallDelta(toolCalls, delta.tool_calls)
        if (choice?.finish_reason) finishReason = choice.finish_reason
      } catch {
        // partial SSE frame — wait for more
      }
    }
  }

  return { content, toolCalls, finishReason }
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
