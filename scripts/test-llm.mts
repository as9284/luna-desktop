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
import {
  parseTextToolCalls, makeToolTextFilter, partialMarkerTail, stripReasoning,
  textCallAssistantContent, textCallObservationContent,
} from '../electron/llm/toolText'
import { diagnoseRepair, applyRepair, foldSystemMessages, adaptivePost, _resetRepairCache, type Repair } from '../electron/llm/adapt'
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

  // the shape actually observed in the wild: DSML openers, but STANDARD `</invoke>` /
  // `</parameter>` closes (the parser tolerates DSML-flavored closes defensively, but real
  // output mixes DSML openers with plain closes — this is the exact case the fix targets)
  const mixed =
    'Saving the file.\n' +
    '<｜｜DSML｜｜tool_calls>\n' +
    '<｜｜DSML｜｜invoke name="write_file">\n' +
    '<｜｜DSML｜｜parameter name="path" string="true">notes.txt</parameter>\n' +
    '<｜｜DSML｜｜parameter name="content" string="true">line one <b>bold</b></parameter>\n' +
    '</invoke>\n' +
    '</｜｜DSML｜｜tool_calls>'
  const mp = parseTextToolCalls(mixed)
  ok('DSML openers with standard closes parse', mp?.calls.length === 1, String(mp?.calls.length))
  ok('reads the tool name through mixed close tags', mp?.calls[0]?.function.name === 'write_file')
  ok(
    'preserves args across DSML-open / standard-close params',
    JSON.parse(mp?.calls[0]?.function.arguments || '{}').content === 'line one <b>bold</b>',
    mp?.calls[0]?.function.arguments,
  )
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

// ---- Hermes / Qwen dialect (JSON inside <tool_call> tags) -----------------
section('Text tool-call parser — Hermes / Qwen dialect')
{
  const one = parseTextToolCalls('Let me look.\n<tool_call>{"name": "web_search", "arguments": {"query": "eu heatwave deaths"}}</tool_call>')
  ok('detects a Hermes tool-call block', !!one)
  ok('keeps the prose before the Hermes block', one?.clean === 'Let me look.', JSON.stringify(one?.clean))
  ok('parses the Hermes invoke', one?.calls.length === 1 && one?.calls[0]?.function.name === 'web_search', String(one?.calls.length))
  ok('serializes Hermes arguments to a JSON string', JSON.parse(one?.calls[0]?.function.arguments || '{}').query === 'eu heatwave deaths', one?.calls[0]?.function.arguments)

  // two calls, back to back
  const two = parseTextToolCalls('<tool_call>{"name":"a","arguments":{}}</tool_call>\n<tool_call>{"name":"b","arguments":{"x":1}}</tool_call>')
  ok('parses multiple Hermes blocks', two?.calls.length === 2 && two?.calls[1]?.function.name === 'b', String(two?.calls.length))

  // arguments already given as a JSON string are preserved, not double-encoded
  const strArgs = parseTextToolCalls('<tool_call>{"name":"read_file","arguments":"{\\"path\\":\\"a.txt\\"}"}</tool_call>')
  ok('keeps string-form Hermes arguments as-is', JSON.parse(strArgs?.calls[0]?.function.arguments || '{}').path === 'a.txt', strArgs?.calls[0]?.function.arguments)

  // truncated (no closing tag) → clean prose, zero calls
  const cut = parseTextToolCalls('Working.\n<tool_call>{"name":"web_search","arg')
  ok('truncated Hermes block → clean prose, zero calls', cut?.clean === 'Working.' && cut?.calls.length === 0)
}

// ---- Mistral dialect ([TOOL_CALLS] + JSON array) --------------------------
section('Text tool-call parser — Mistral dialect')
{
  const m = parseTextToolCalls('[TOOL_CALLS][{"name": "web_search", "arguments": {"query": "turkey customs"}}]')
  ok('detects a Mistral tool-call block', !!m)
  ok('parses the Mistral call', m?.calls.length === 1 && m?.calls[0]?.function.name === 'web_search', String(m?.calls.length))
  ok('reads Mistral arguments', JSON.parse(m?.calls[0]?.function.arguments || '{}').query === 'turkey customs', m?.calls[0]?.function.arguments)

  const multi = parseTextToolCalls('[TOOL_CALLS][{"name":"a","arguments":{}},{"name":"b","arguments":{}}]')
  ok('parses a Mistral array of calls', multi?.calls.length === 2, String(multi?.calls.length))

  // trailing prose after the array must not break extraction
  const trail = parseTextToolCalls('[TOOL_CALLS][{"name":"a","arguments":{}}] done')
  ok('Mistral array with trailing text still parses', trail?.calls.length === 1, String(trail?.calls.length))

  // truncated array → zero calls
  const cut = parseTextToolCalls('[TOOL_CALLS][{"name":"a","argu')
  ok('truncated Mistral block → zero calls', cut?.calls.length === 0)
}

// ---- Inline reasoning stripping -------------------------------------------
section('Reasoning stripping (stripReasoning)')
{
  ok('removes a paired <think> block', stripReasoning('<think>plan the answer</think>Here it is.') === 'Here it is.')
  ok('removes a <thinking> variant', stripReasoning('<thinking>hmm</thinking>Answer.') === 'Answer.')
  ok('keeps content that has no reasoning', stripReasoning('Just an answer.') === 'Just an answer.')
  ok('drops an unclosed trailing <think>', stripReasoning('Partial answer.\n<think>still reasoning and cut off') === 'Partial answer.')
  ok('handles reasoning followed by a tool block', stripReasoning('<think>should I search?</think>Let me search.\n<function_calls>').startsWith('Let me search.'))
}

section('Stream filter — inline reasoning is suppressed')
{
  // <think> region dropped, the answer after it streams through
  const out1: string[] = []
  const f1 = makeToolTextFilter((t) => out1.push(t))
  f1.push('<think>I should be concise.</think>')
  f1.push('The answer is 42.')
  f1.flush()
  ok('suppresses a <think> region, streams the answer', out1.join('') === 'The answer is 42.', JSON.stringify(out1.join('')))

  // <think> opener split across chunks is still caught
  const out2: string[] = []
  const f2 = makeToolTextFilter((t) => out2.push(t))
  for (const c of ['Sure. <th', 'ink>reasoning', ' here</thi', 'nk>Done.']) f2.push(c)
  f2.flush()
  ok('suppresses a split <think> opener/close', out2.join('') === 'Sure. Done.', JSON.stringify(out2.join('')))

  // reasoning THEN a tool call: reasoning dropped, prose kept, tool block suppressed
  const out3: string[] = []
  const f3 = makeToolTextFilter((t) => out3.push(t))
  f3.push('<think>plan</think>Looking that up.\n<tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>')
  f3.flush()
  ok('reasoning dropped, prose kept, tool block suppressed', out3.join('') === 'Looking that up.\n', JSON.stringify(out3.join('')))
  ok('filter stops after the tool block that followed reasoning', f3.stopped)

  // unterminated reasoning at end of stream is dropped, not leaked
  const out4: string[] = []
  const f4 = makeToolTextFilter((t) => out4.push(t))
  f4.push('Here goes. <think>cut off mid thought')
  f4.flush()
  ok('unterminated reasoning is dropped on flush', out4.join('') === 'Here goes. ', JSON.stringify(out4.join('')))
}

// ---- Text-dialect continuation turns --------------------------------------
section('Text-dialect continuation shape')
{
  const calls = parseTextToolCalls('Searching now.\n<tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>')!.calls
  ok('assistant turn keeps prose, drops the raw block', textCallAssistantContent('Searching now.', calls) === 'Searching now.')
  ok('assistant turn falls back to a tool-named note when prose is empty', textCallAssistantContent('', calls) === '(Calling web_search.)')

  const obs = textCallObservationContent([{ name: 'web_search', result: '{"hits":3}' }, { name: 'read_file', result: 'ok' }])
  ok('observation labels each result', obs.includes('[web_search result]\n{"hits":3}') && obs.includes('[read_file result]\nok'))
  ok('observation carries a steering nudge to continue', /call another tool|final reply/i.test(obs))
}

// ---- Native tool_call id synthesis ----------------------------------------
section('OpenAI adapter — synthesizes missing tool_call ids')
{
  stubFetch(sse([
    '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"web_search","arguments":"{\\"query\\":\\"x\\"}"}}]}}]}',
    '{"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"name":"read_file","arguments":"{}"}}]}}]}',
    '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    '[DONE]',
  ]))
  const r = await streamOpenAI(OA, 'k', [{ role: 'user', content: 'hi' }], { tools: [] }, () => {})
  ok('two tool calls parsed', r.toolCalls.length === 2, String(r.toolCalls.length))
  ok('missing ids are synthesized and unique', r.toolCalls[0].id === 'call_0' && r.toolCalls[1].id === 'call_1', JSON.stringify(r.toolCalls.map((c) => c.id)))
}

// ---- Reasoning content field is ignored, not streamed ---------------------
section('OpenAI adapter — reasoning_content is not streamed as answer')
{
  stubFetch(sse([
    '{"choices":[{"delta":{"reasoning_content":"let me think"}}]}',
    '{"choices":[{"delta":{"content":"The answer."}}]}',
    '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
    '[DONE]',
  ]))
  const deltas: string[] = []
  const r = await streamOpenAI(OA, 'k', [{ role: 'user', content: 'hi' }], {}, (d) => deltas.push(d))
  ok('reasoning_content never reaches the stream', deltas.join('') === 'The answer.', JSON.stringify(deltas.join('')))
  ok('content is just the answer', r.content === 'The answer.')
}

// ---- Request adaptation (defensive param/role repair) ---------------------
section('Request adaptation — diagnose / applyRepair')
{
  const none = new Set<Repair>()
  ok('temperature 400 → dropTemperature', diagnoseRepair(400, "Unsupported value: 'temperature' is not supported", none) === 'dropTemperature')
  ok('tools 400 → dropTools', diagnoseRepair(400, 'This model does not support tools', none) === 'dropTools')
  ok('system 400 → foldSystem', diagnoseRepair(400, "Invalid role: 'system' is not supported by this model", none) === 'foldSystem')
  ok('a non-400 is never adapted', diagnoseRepair(500, 'temperature exploded', none) === null)
  ok('an already-applied repair is not re-picked', diagnoseRepair(400, 'temperature not supported', new Set<Repair>(['dropTemperature'])) === null)

  ok('applyRepair drops temperature', applyRepair({ temperature: 0.7, model: 'm' }, 'dropTemperature').temperature === undefined)
  const droppedTools = applyRepair({ tools: [1], tool_choice: 'auto', model: 'm' }, 'dropTools')
  ok('applyRepair drops tools and tool_choice', droppedTools.tools === undefined && droppedTools.tool_choice === undefined)

  const folded = foldSystemMessages([
    { role: 'system', content: 'You are Luna.' },
    { role: 'user', content: 'Hello.' },
  ])
  ok('foldSystem removes the system role', folded.every((m) => m.role !== 'system'))
  ok('foldSystem prepends system text to the first user message', folded[0].role === 'user' && folded[0].content === 'You are Luna.\n\nHello.', JSON.stringify(folded[0].content))
  ok('foldSystem is a no-op with no system message', foldSystemMessages([{ role: 'user', content: 'hi' }]).length === 1)
}

section('Request adaptation — adaptivePost retries a 400, then caches the repair')
{
  _resetRepairCache()
  let calls = 0
  // 400 whenever the body still carries a temperature; 200 once it's been dropped
  // @ts-expect-error override global for the test
  globalThis.fetch = async (_url: string, init: { body: string }) => {
    calls++
    return 'temperature' in JSON.parse(init.body)
      ? new Response("'temperature' is not supported by this model", { status: 400 })
      : new Response('{"ok":true}', { status: 200 })
  }
  const res = await adaptivePost('https://x/chat/completions', {}, { temperature: 0.7, model: 'm', messages: [] }, 'x::m')
  ok('retries after dropping the rejected temperature', res.status === 200 && calls === 2, `calls=${calls}`)

  // the learned repair is remembered: the next request pre-drops temperature (one call, no 400)
  calls = 0
  const res2 = await adaptivePost('https://x/chat/completions', {}, { temperature: 0.7, model: 'm', messages: [] }, 'x::m')
  ok('a learned repair is pre-applied on the next request', res2.status === 200 && calls === 1, `calls=${calls}`)

  // an un-adaptable 400 is surfaced as an error, not retried forever
  _resetRepairCache()
  // @ts-expect-error override global for the test
  globalThis.fetch = async () => new Response('quota exceeded', { status: 400 })
  let threw = ''
  try {
    await adaptivePost('https://x/chat/completions', {}, { model: 'm', messages: [] }, 'y::m')
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e)
  }
  ok('an un-adaptable 400 throws the provider error', threw.includes('400') && threw.includes('quota'), threw)
}

console.log(`\n\x1b[1mResults: \x1b[32m${pass} passed\x1b[0m, ${fail ? `\x1b[31m${fail} failed\x1b[0m` : '0 failed'}`)
process.exit(fail ? 1 : 0)
