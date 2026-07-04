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
import { parseTextToolCalls, makeToolTextFilter, partialMarkerTail } from '../electron/llm/toolText'
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

// ---- text-format tool calls (models that emit XML instead of native tool_calls) ----------
section('Text tool-call parser')
{
  // the exact shape DeepSeek V4 Flash emits
  const content =
    'Let me look that up.\n' +
    '<function_calls>\n' +
    '<invoke name="web_search">\n' +
    '<parameter name="query" string="true">HS code 851712 smartphone Turkey import duty 2025</parameter>\n' +
    '</invoke>\n' +
    '<invoke name="web_search">\n' +
    '<parameter name="query" string="true">Turkey VAT rate 2025 percentage</parameter>\n' +
    '</invoke>\n' +
    '</function_calls>'
  const parsed = parseTextToolCalls(content)
  ok('detects a text tool-call block', !!parsed)
  ok('keeps the prose before the block as clean content', parsed?.clean === 'Let me look that up.', JSON.stringify(parsed?.clean))
  ok('parses every invoke in the block', parsed?.calls.length === 2, String(parsed?.calls.length))
  ok('reads the tool name', parsed?.calls[0]?.function.name === 'web_search')
  ok(
    'reads the parameter value as valid JSON arguments',
    parsed?.calls[0]?.function.arguments === JSON.stringify({ query: 'HS code 851712 smartphone Turkey import duty 2025' }),
    parsed?.calls[0]?.function.arguments,
  )

  ok('returns null when there is no block', parseTextToolCalls('just a normal answer, no tools.') === null)

  // typed parameters coerce off their hint
  const typed = parseTextToolCalls(
    '<function_calls><invoke name="orbit_set_task_done">' +
    '<parameter name="id" string="true">t1</parameter>' +
    '<parameter name="done" boolean="true">true</parameter>' +
    '</invoke></function_calls>',
  )
  ok('coerces a boolean parameter', typed?.calls[0]?.function.arguments === JSON.stringify({ id: 't1', done: true }), typed?.calls[0]?.function.arguments)

  // a truncated block (stream cut off mid-value) yields the clean prose and no calls
  const cut = parseTextToolCalls('Working on it.\n<function_calls>\n<invoke name="export_pdf">\n<parameter name="html" string="true"><html>')
  ok('truncated block → clean prose, zero calls', cut?.clean === 'Working on it.' && cut?.calls.length === 0)
}

section('Text tool-call stream filter')
{
  // clean prose flows through; the XML never reaches the sink, even split across chunks
  const chunks = ['Let me look ', 'that up.', '<function', '_calls>\n<invoke name="web_search">', '<parameter name="query" string="true">x</parameter></invoke></function_calls>']
  const out: string[] = []
  const filter = makeToolTextFilter((t) => out.push(t))
  for (const c of chunks) filter.push(c)
  filter.flush()
  ok('streams only the prose, suppresses the XML', out.join('') === 'Let me look that up.', JSON.stringify(out.join('')))
  ok('filter marks itself stopped after the marker', filter.stopped)

  // no block → everything is emitted, including a trailing held-back tail
  const out2: string[] = []
  const f2 = makeToolTextFilter((t) => out2.push(t))
  f2.push('a plain answer with a < in it')
  f2.flush()
  ok('passes normal text through untouched', out2.join('') === 'a plain answer with a < in it', JSON.stringify(out2.join('')))

  ok('partialMarkerTail holds a split marker prefix', partialMarkerTail('foo <function') === 9)
  ok('partialMarkerTail holds nothing for unrelated text', partialMarkerTail('all done.') === 0)
}

// ---- DSML dialect (DeepSeek V4 Flash/Pro) ---------------------------------
// DeepSeek V4 emits tool calls as text using a `<｜｜DSML｜｜…>` marker dialect where ｜ is
// U+FF5C (fullwidth bar). The structure is otherwise identical to the Anthropic XML dialect.
section('Text tool-call parser — DSML dialect (DeepSeek V4)')
{
  // the exact shape DeepSeek V4 emits, including a large HTML `content` argument with nested
  // tags — the case that was leaking into the chat before this fix
  const html = '<!DOCTYPE html><html><head><style>body{color:#1a1a1a}</style></head>' +
    '<body><h1>Europe\'s Deadly Heatwave</h1><p>France has reported 2,025 excess deaths.</p>' +
    '<div class="stat-grid"><div class="stat-card">2,025</div></div></body></html>'
  const content =
    'Writing the briefing to the workspace.\n' +
    '<｜｜DSML｜｜tool_calls>\n' +
    '<｜｜DSML｜｜invoke name="write_file">\n' +
    `<｜｜DSML｜｜parameter name="content" string="true">${html}</｜｜DSML｜｜parameter>\n` +
    '<｜｜DSML｜｜parameter name="path" string="true">C:\\Users\\Anthony Saliba\\Documents\\Luna\\europe-heatwave-2025\\briefing.html</｜｜DSML｜｜parameter>\n' +
    '</｜｜DSML｜｜invoke>\n' +
    '</｜｜DSML｜｜tool_calls>'
  const parsed = parseTextToolCalls(content)
  ok('detects a DSML tool-call block', !!parsed)
  ok('keeps the prose before the DSML block as clean content', parsed?.clean === 'Writing the briefing to the workspace.', JSON.stringify(parsed?.clean))
  ok('parses the invoke in a DSML block', parsed?.calls.length === 1, String(parsed?.calls.length))
  ok('reads the tool name from a DSML block', parsed?.calls[0]?.function.name === 'write_file')
  ok(
    'preserves a large HTML content argument with nested tags intact',
    JSON.parse(parsed?.calls[0]?.function.arguments || '{}').content === html,
    parsed?.calls[0]?.function.arguments,
  )
  ok(
    'preserves a Windows path argument with backslashes',
    JSON.parse(parsed?.calls[0]?.function.arguments || '{}').path === 'C:\\Users\\Anthony Saliba\\Documents\\Luna\\europe-heatwave-2025\\briefing.html',
    parsed?.calls[0]?.function.arguments,
  )

  // a DSML block truncated mid-value yields the clean prose and zero calls
  const cut = parseTextToolCalls('Working on it.\n<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="export_pdf">\n<｜｜DSML｜｜parameter name="html" string="true"><html>')
  ok('truncated DSML block → clean prose, zero calls', cut?.clean === 'Working on it.' && cut?.calls.length === 0)
}

section('Text tool-call stream filter — DSML dialect')
{
  // the DSML opener split across chunks must still be suppressed. The prose before the
  // opener (including its trailing newline) is emitted verbatim; the split marker is withheld.
  const chunks = [
    'Writing the briefing.\n',
    '<｜｜',
    'DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="write_file">',
    '<｜｜DSML｜｜parameter name="path" string="true">a.html</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
  ]
  const out: string[] = []
  const filter = makeToolTextFilter((t) => out.push(t))
  for (const c of chunks) filter.push(c)
  filter.flush()
  ok('streams only the prose, suppresses a split DSML opener', out.join('') === 'Writing the briefing.\n', JSON.stringify(out.join('')))
  ok('filter marks itself stopped after the DSML marker', filter.stopped)

  // a DSML-flavored partial prefix is held back, not emitted. `<｜｜DSML` (7 chars) is a
  // prefix of the opener `<｜｜DSML｜｜tool_calls`; `<｜｜D` (4 chars) is a shorter prefix.
  ok('partialMarkerTail holds a split DSML opener prefix', partialMarkerTail('foo <｜｜DSML') === 7)
  ok('partialMarkerTail holds the longest across dialects', partialMarkerTail('foo <｜｜D') === 4)
}

console.log(`\n\x1b[1mResults: \x1b[32m${pass} passed\x1b[0m, ${fail ? `\x1b[31m${fail} failed\x1b[0m` : '0 failed'}`)
process.exit(fail ? 1 : 0)
