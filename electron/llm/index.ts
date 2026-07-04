import { ipcMain } from 'electron'
import fs from 'node:fs/promises'
import {
  getConfig, setConfig, getSlotKey, hasSlotKey, saveSlotKey, migrateLegacyKey,
  type ChatMsg, type ModelConfig, type Slot, type StreamResult, type ToolDef,
} from './config'
import { streamOpenAI, completeOpenAI } from './openai'
import { streamAnthropic, completeAnthropic } from './anthropic'
import { makeToolTextFilter, parseTextToolCalls, stripReasoning } from './toolText'

/** Set LUNA_LLM_DEBUG=1 to log each round's outbound convo and the parsed model output to stderr.
 *  The only way to see WHY a given model stops or loops mid tool-chain without a live debugger. */
const DEBUG = !!process.env.LUNA_LLM_DEBUG

function logRequest(cfg: ModelConfig, convo: ChatMsg[], opts: StreamOpts) {
  const roles = convo
    .map((m) => {
      const size = typeof m.content === 'string' ? m.content.length : Array.isArray(m.content) ? `${m.content.length}p` : 0
      return `${m.role}(${size})${m.tool_calls?.length ? `+${m.tool_calls.length}tc` : ''}`
    })
    .join(' → ')
  console.error(`[llm] → ${cfg.protocol} ${cfg.model} tools:${opts.tools?.length ?? 0} | ${roles}`)
}

function logResult(kind: string, content: string, calls: { function: { name: string } }[]) {
  const names = calls.map((c) => c.function.name).join(', ')
  console.error(`[llm] ← ${kind} calls:[${names}] text:${JSON.stringify((content || '').slice(0, 120))}`)
}

export type { ChatMsg, ContentPart, ToolDef, ToolCall, StreamResult, Slot, Protocol, ModelConfig } from './config'
export { textCallAssistantContent, textCallObservationContent } from './toolText'

const NO_KEY = 'NO_KEY'
export const isNoKey = (e: unknown) => e instanceof Error && e.message === NO_KEY
export { hasSlotKey as hasKey }

export interface StreamOpts {
  temperature?: number
  tools?: ToolDef[]
  signal?: AbortSignal
}

/** Stream a completion from a slot, dispatching on its configured protocol. */
export async function streamChat(
  slot: Slot,
  convo: ChatMsg[],
  opts: StreamOpts,
  onDelta: (text: string) => void,
): Promise<StreamResult> {
  const cfg = getConfig(slot)
  const key = getSlotKey(slot)
  if (!key) throw new Error(NO_KEY)

  if (DEBUG) logRequest(cfg, convo, opts)

  // Some models emit tool calls as text (function-calling XML/JSON dialects) instead of native
  // tool_calls/tool_use, and some leak <think> reasoning inline. The filter keeps both out of the
  // live stream; parseTextToolCalls rescues the calls and stripReasoning drops the reasoning.
  const filter = makeToolTextFilter(onDelta)
  const result =
    cfg.protocol === 'anthropic'
      ? await streamAnthropic(cfg, key, convo, opts, (t) => filter.push(t))
      : await streamOpenAI(cfg, key, convo, opts, (t) => filter.push(t))
  filter.flush()

  // Strip inline reasoning from the content too (the filter already kept it out of the stream) so
  // it never enters the history we replay to the model or the prose we parse tool calls out of.
  const content = stripReasoning(result.content)

  // Native tool_calls win. Some OpenAI-compatible providers (DeepSeek among them) stream them but
  // report a finish_reason other than 'tool_calls' (e.g. 'stop', or null when the reason chunk is
  // missed). The tool loop gates on calls being present, so normalize the reason here.
  if (result.toolCalls.length) {
    if (DEBUG) logResult('native', content, result.toolCalls)
    return { ...result, content, finishReason: 'tool_calls' }
  }

  // No native calls — rescue a text-format tool block if one is present and tools were offered.
  const parsed = parseTextToolCalls(content)
  if (parsed && opts.tools?.length && parsed.calls.length) {
    // Hand back the CLEAN prose (not the raw call block) plus the parsed calls, flagged so the
    // loop replays clean history and feeds results back as a ReAct observation the model will
    // continue from — replaying the raw block makes weaker models echo the call instead of using
    // the result. See textCallAssistantContent / textCallObservationContent in ipc/luna.ts.
    if (DEBUG) logResult('text', parsed.clean, parsed.calls)
    return { content: parsed.clean, toolCalls: parsed.calls, finishReason: 'tool_calls', textToolCalls: true }
  }
  // A block that was truncated/malformed, or tools weren't offered: keep the clean prose so no
  // tags surface in chat. Otherwise the reasoning-stripped content is the final answer.
  const finalContent = parsed ? parsed.clean : content
  if (DEBUG) logResult('final', finalContent, [])
  return { ...result, content: finalContent }
}

/** One-shot (non-streaming) completion — used for meeting wrap-ups and Atlas digests. */
export async function complete(slot: Slot, convo: ChatMsg[], opts: { temperature?: number; signal?: AbortSignal } = {}): Promise<string> {
  const cfg = getConfig(slot)
  const key = getSlotKey(slot)
  if (!key) throw new Error(NO_KEY)
  const raw = cfg.protocol === 'anthropic' ? await completeAnthropic(cfg, key, convo, opts) : await completeOpenAI(cfg, key, convo, opts)
  // a reasoning model may inline <think>…</think> in the one-shot content — keep it out of summaries
  return stripReasoning(raw)
}

/* ---------------- vision ---------------- */

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
}
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

export const isImageExt = (ext: string): boolean => ext.toLowerCase() in IMAGE_MIME

/** Turn an image file into rich text (description + verbatim OCR). Uses the dedicated vision slot
 *  when one is configured, otherwise falls back to the main slot — so a single multimodal model
 *  set as `main` can see images without a separate vision key. */
export async function describeImage(realPath: string, question?: string): Promise<{ ok: boolean; text: string; error?: string }> {
  const ext = realPath.slice(realPath.lastIndexOf('.')).toLowerCase()
  const mimeType = IMAGE_MIME[ext]
  if (!mimeType) return { ok: false, text: '', error: 'Unsupported image type.' }
  const slot: Slot | null = hasSlotKey('vision') ? 'vision' : hasSlotKey('main') ? 'main' : null
  if (!slot) return { ok: false, text: '', error: 'No model set — add a key in Settings to let Luna see images.' }
  let buf: Buffer
  try {
    buf = await fs.readFile(realPath)
  } catch (e) {
    return { ok: false, text: '', error: e instanceof Error ? e.message : String(e) }
  }
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, text: '', error: `Image is too large (${(buf.length / 1048576).toFixed(1)} MB).` }

  const prompt = question?.trim() || 'Describe this image in thorough detail, and transcribe any visible text verbatim.'
  const convo: ChatMsg[] = [
    { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image', mimeType, dataBase64: buf.toString('base64') }] },
  ]
  try {
    const text = (await complete(slot, convo, { temperature: 0.2 })).trim()
    return text ? { ok: true, text } : { ok: false, text: '', error: 'The model returned nothing for this image.' }
  } catch (e) {
    return { ok: false, text: '', error: isNoKey(e) ? 'No model configured to read images.' : e instanceof Error ? e.message : String(e) }
  }
}

/* ---------------- connection test ---------------- */

/** Live sanity check: a tiny real request to the slot's endpoint with its key + model. */
export async function testConnection(slot: Slot): Promise<{ ok: boolean; error?: string }> {
  if (!hasSlotKey(slot)) return { ok: false, error: 'No API key set for this model.' }
  try {
    await complete(slot, [{ role: 'user', content: 'Reply with just: ok' }], { temperature: 0, signal: AbortSignal.timeout(20000) })
    return { ok: true }
  } catch (e) {
    if (isNoKey(e)) return { ok: false, error: 'No API key set for this model.' }
    const msg = e instanceof Error ? e.message : String(e)
    if ((e as Error)?.name === 'TimeoutError' || /abort|timed? ?out/i.test(msg)) return { ok: false, error: 'Timed out — check the base URL.' }
    return { ok: false, error: msg }
  }
}

/* ---------------- renderer config IPC ---------------- */

const isSlot = (s: unknown): s is Slot => s === 'main' || s === 'vision'

export function registerLlm() {
  migrateLegacyKey()
  ipcMain.handle('llm:get', () => ({
    main: { ...getConfig('main'), hasKey: hasSlotKey('main') },
    vision: { ...getConfig('vision'), hasKey: hasSlotKey('vision') },
  }))
  ipcMain.handle('llm:set-config', (_e, slot: unknown, patch: Partial<ModelConfig>) =>
    isSlot(slot) ? setConfig(slot, patch ?? {}) : null,
  )
  ipcMain.handle('llm:set-key', (_e, slot: unknown, key: string) => {
    if (isSlot(slot)) saveSlotKey(slot, typeof key === 'string' ? key : '')
    return true
  })
  ipcMain.handle('llm:clear-key', (_e, slot: unknown) => {
    if (isSlot(slot)) saveSlotKey(slot, '')
    return true
  })
  ipcMain.handle('llm:test', (_e, slot: unknown) =>
    isSlot(slot) ? testConnection(slot) : Promise.resolve({ ok: false, error: 'Unknown model slot.' }),
  )
}
