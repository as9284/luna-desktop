import { ipcMain } from 'electron'
import fs from 'node:fs/promises'
import {
  getConfig, setConfig, getSlotKey, hasSlotKey, saveSlotKey, migrateLegacyKey,
  type ChatMsg, type ModelConfig, type Slot, type StreamResult, type ToolDef,
} from './config'
import { streamOpenAI, completeOpenAI } from './openai'
import { streamAnthropic, completeAnthropic } from './anthropic'
import { makeToolTextFilter, parseTextToolCalls } from './toolText'

export type { ChatMsg, ContentPart, ToolDef, ToolCall, StreamResult, Slot, Protocol, ModelConfig } from './config'

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

  // Some models emit tool calls as text (Anthropic function-calling XML) instead of native
  // tool_calls/tool_use. The filter keeps that XML out of the live stream; parseTextToolCalls
  // turns it back into real tool calls after the stream ends.
  const filter = makeToolTextFilter(onDelta)
  const result =
    cfg.protocol === 'anthropic'
      ? await streamAnthropic(cfg, key, convo, opts, (t) => filter.push(t))
      : await streamOpenAI(cfg, key, convo, opts, (t) => filter.push(t))

  if (result.toolCalls.length) {
    filter.flush()
    // Some OpenAI-compatible providers (DeepSeek among them) stream native tool_calls but
    // report a finish_reason other than 'tool_calls' (e.g. 'stop', or null when the reason
    // chunk is missed). The tool loop gates on tool calls being present, so normalize the
    // reason here — what matters is that there are calls to execute, not the exact string.
    return { ...result, finishReason: 'tool_calls' }
  }
  const parsed = parseTextToolCalls(result.content)
  if (!parsed) {
    filter.flush()
    return result
  }
  // A text tool-call block was present (and already withheld from the stream). The renderer saw
  // only parsed.clean (the filter suppressed the block), but the conversation history sent back
  // to the model should keep the FULL assistant content — models that emit text-format calls
  // (DeepSeek V4's DSML dialect) need to see their own emitted block to continue the tool chain
  // in the next round. Stripping it to parsed.clean can make the model think it never called the
  // tool and stop after one round. The textToolCalls flag tells the loop to format the tool
  // result as a user message (not a tool-role message) so the model that doesn't use native
  // tool calling can follow the chain.
  if (opts.tools?.length && parsed.calls.length) {
    return { content: result.content, toolCalls: parsed.calls, finishReason: 'tool_calls', textToolCalls: true }
  }
  // Tools weren't offered this round, or the block was truncated/malformed: drop the raw XML,
  // keep only the clean prose so the tags never surface in the chat.
  return { ...result, content: parsed.clean }
}

/** One-shot (non-streaming) completion — used for meeting wrap-ups and Atlas digests. */
export async function complete(slot: Slot, convo: ChatMsg[], opts: { temperature?: number; signal?: AbortSignal } = {}): Promise<string> {
  const cfg = getConfig(slot)
  const key = getSlotKey(slot)
  if (!key) throw new Error(NO_KEY)
  return cfg.protocol === 'anthropic' ? completeAnthropic(cfg, key, convo, opts) : completeOpenAI(cfg, key, convo, opts)
}

/* ---------------- vision ---------------- */

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
}
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

export const isImageExt = (ext: string): boolean => ext.toLowerCase() in IMAGE_MIME

/** Turn an image file into rich text (description + verbatim OCR) via the vision slot. */
export async function describeImage(realPath: string, question?: string): Promise<{ ok: boolean; text: string; error?: string }> {
  const ext = realPath.slice(realPath.lastIndexOf('.')).toLowerCase()
  const mimeType = IMAGE_MIME[ext]
  if (!mimeType) return { ok: false, text: '', error: 'Unsupported image type.' }
  if (!hasSlotKey('vision')) return { ok: false, text: '', error: 'No vision model set — add a vision key in Settings to let Luna see images.' }
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
    const text = (await complete('vision', convo, { temperature: 0.2 })).trim()
    return text ? { ok: true, text } : { ok: false, text: '', error: 'The vision model returned nothing.' }
  } catch (e) {
    return { ok: false, text: '', error: isNoKey(e) ? 'No vision model configured.' : e instanceof Error ? e.message : String(e) }
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
