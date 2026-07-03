/**
 * Backend harness for the universal LLM layer.
 * Run: npx tsx scripts/test-llm.mts
 *
 * Stubs fetch with canned SSE streams to verify both protocol adapters parse text deltas,
 * tool calls, and finish reasons correctly — and checks the OpenAI→Anthropic message/tool
 * translation (system extraction, tool_use assembly, tool_result folding, images).
 */
import { streamOpenAI } from '../electron/llm/openai'
import { streamAnthropic, toAnthropic } from '../electron/llm/anthropic'
import type { ChatMsg, ModelConfig } from '../electron/llm/config'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`) }
}
const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`)

const sse = (lines: string[]) => lines.map((l) => `data: ${l}`).join('\n') + '\n'
const stubFetch = (body: string) => {
  // @ts-expect-error override global for the test
  globalThis.fetch = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
const OA: ModelConfig = { protocol: 'openai', baseUrl: 'https://x', model: 'm' }
const AN: ModelConfig = { protocol: 'anthropic', baseUrl: 'https://x', model: 'm' }

// ---- OpenAI streaming -----------------------------------------------------
section('OpenAI adapter — text stream')
{
  stubFetch(sse([
    '{"choices":[{"delta":{"content":"Hel"}}]}',
    '{"choices":[{"delta":{"content":"lo"}}]}',
    '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
    '[DONE]',
  ]))
  const deltas: string[] = []
  const r = await streamOpenAI(OA, 'k', [{ role: 'user', content: 'hi' }], {}, (d) => deltas.push(d))
  ok('accumulates streamed text', r.content === 'Hello', r.content)
  ok('reports finish_reason', r.finishReason === 'stop')
  ok('forwards each delta to onDelta', deltas.join('|') === 'Hel|lo')
}

section('OpenAI adapter — tool call stream')
{
  stubFetch(sse([
    '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}',
    '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.txt\\"}"}}]}}]}',
    '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    '[DONE]',
  ]))
  const r = await streamOpenAI(OA, 'k', [{ role: 'user', content: 'x' }], {}, () => {})
  ok('assembles a tool call across chunks', r.toolCalls.length === 1 && r.toolCalls[0].function.name === 'read_file')
  ok('concatenates streamed tool arguments', r.toolCalls[0]?.function.arguments === '{"path":"a.txt"}', r.toolCalls[0]?.function.arguments)
  ok('reports tool_calls finish reason', r.finishReason === 'tool_calls')
}

// ---- Anthropic streaming --------------------------------------------------
section('Anthropic adapter — text stream')
{
  stubFetch(sse([
    '{"type":"message_start","message":{}}',
    '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
    '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}',
    '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}',
    '{"type":"content_block_stop","index":0}',
    '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    '{"type":"message_stop"}',
  ]))
  const deltas: string[] = []
  const r = await streamAnthropic(AN, 'k', [{ role: 'user', content: 'hi' }], {}, (d) => deltas.push(d))
  ok('accumulates streamed text', r.content === 'Hi there', r.content)
  ok('maps end_turn → stop', r.finishReason === 'stop')
  ok('forwards each delta', deltas.join('|') === 'Hi| there')
}

section('Anthropic adapter — tool_use stream')
{
  stubFetch(sse([
    '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file"}}',
    '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\""}}',
    '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":":\\"a.txt\\"}"}}',
    '{"type":"content_block_stop","index":0}',
    '{"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
  ]))
  const r = await streamAnthropic(AN, 'k', [{ role: 'user', content: 'x' }], {}, () => {})
  ok('captures the tool_use id + name', r.toolCalls[0]?.id === 'toolu_1' && r.toolCalls[0]?.function.name === 'read_file')
  ok('accumulates input_json_delta into arguments', r.toolCalls[0]?.function.arguments === '{"path":"a.txt"}', r.toolCalls[0]?.function.arguments)
  ok('maps stop_reason tool_use → tool_calls', r.finishReason === 'tool_calls')
}

// ---- translation ----------------------------------------------------------
section('OpenAI → Anthropic message translation')
{
  const convo: ChatMsg[] = [
    { role: 'system', content: 'You are Luna.' },
    { role: 'user', content: 'Read a.txt and b.txt' },
    { role: 'assistant', content: null, tool_calls: [
      { id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
      { id: 't2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.txt"}' } },
    ] },
    { role: 'tool', tool_call_id: 't1', content: 'contents A' },
    { role: 'tool', tool_call_id: 't2', content: 'contents B' },
    { role: 'assistant', content: 'Done.' },
  ]
  const { system, messages } = toAnthropic(convo)
  ok('system prompt is lifted out', system === 'You are Luna.')
  ok('system is not left in messages', !messages.some((m) => (m as { role: string }).role === 'system'))
  const assistantToolMsg = messages[1] as { role: string; content: { type: string; name?: string }[] }
  ok('assistant tool_calls → tool_use blocks', assistantToolMsg.role === 'assistant' && assistantToolMsg.content.filter((c) => c.type === 'tool_use').length === 2)
  const toolResultMsg = messages[2] as { role: string; content: { type: string; tool_use_id?: string }[] }
  ok('both tool results fold into ONE user turn', toolResultMsg.role === 'user' && toolResultMsg.content.length === 2 && toolResultMsg.content.every((c) => c.type === 'tool_result'))
  ok('tool_result ids line up', toolResultMsg.content[0].tool_use_id === 't1' && toolResultMsg.content[1].tool_use_id === 't2')
  ok('final assistant text passes through', (messages[3] as { content: unknown }).content === 'Done.')
}

section('Image content translation')
{
  const convo: ChatMsg[] = [
    { role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image', mimeType: 'image/png', dataBase64: 'AAAA' }] },
  ]
  const { messages } = toAnthropic(convo)
  const parts = (messages[0] as { content: { type: string; source?: { type: string; media_type: string } }[] }).content
  ok('image → anthropic base64 image block', parts.some((p) => p.type === 'image' && p.source?.type === 'base64' && p.source.media_type === 'image/png'))
  ok('text part preserved alongside image', parts.some((p) => p.type === 'text'))
}

console.log(`\n\x1b[1mResults: \x1b[32m${pass} passed\x1b[0m, ${fail ? `\x1b[31m${fail} failed\x1b[0m` : '0 failed'}`)
process.exit(fail ? 1 : 0)
