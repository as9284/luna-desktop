import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getKey, setKey } from '../ipc/keychain'

/**
 * Universal model configuration. Luna talks to any OpenAI-compatible or Anthropic-compatible
 * endpoint, so "the engine" is no longer a hardcoded provider — it's two configurable slots:
 *   - main   → the chat / reasoning / writing model
 *   - vision → the image-understanding fallback (used when a picture needs to be seen)
 *
 * Non-secret config (protocol, base URL, model id) is persisted here; the API key for each
 * slot lives encrypted in the keychain under `llm-<slot>`.
 */

export type Protocol = 'openai' | 'anthropic'
export type Slot = 'main' | 'vision'

export interface ModelConfig {
  protocol: Protocol
  /** provider base, e.g. https://api.deepseek.com or https://api.openai.com/v1 */
  baseUrl: string
  model: string
}

/** A message in the internal (OpenAI-shaped) format the chat loop uses. */
export interface ChatMsg {
  role: string
  content: string | null | ContentPart[]
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; dataBase64: string }
export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
export interface ToolDef {
  type: string
  function: { name: string; description: string; parameters: unknown }
}
export interface StreamResult {
  content: string
  toolCalls: ToolCall[]
  finishReason: string | null
  /** true when the tool calls were rescued from a text-format block (DSML/XML) rather than
   *  returned as native tool_calls by the model. The conversation history is formatted
   *  differently for text-format calls so the model can continue the chain. */
  textToolCalls?: boolean
}

const DEFAULTS: Record<Slot, ModelConfig> = {
  main: { protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  vision: { protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
}

const file = () => path.join(app.getPath('userData'), 'luna-models.json')

function loadAll(): Record<Slot, ModelConfig> {
  let stored: Partial<Record<Slot, Partial<ModelConfig>>> = {}
  try {
    stored = JSON.parse(fs.readFileSync(file(), 'utf8'))
  } catch {
    // no config yet — use defaults
  }
  const merge = (slot: Slot): ModelConfig => {
    const s = stored[slot] ?? {}
    const protocol: Protocol = s.protocol === 'anthropic' ? 'anthropic' : s.protocol === 'openai' ? 'openai' : DEFAULTS[slot].protocol
    return {
      protocol,
      baseUrl: typeof s.baseUrl === 'string' && s.baseUrl.trim() ? s.baseUrl.trim() : DEFAULTS[slot].baseUrl,
      model: typeof s.model === 'string' && s.model.trim() ? s.model.trim() : DEFAULTS[slot].model,
    }
  }
  return { main: merge('main'), vision: merge('vision') }
}

export function getConfig(slot: Slot): ModelConfig {
  return loadAll()[slot]
}

export function setConfig(slot: Slot, patch: Partial<ModelConfig>): ModelConfig {
  const all = loadAll()
  const next: ModelConfig = {
    protocol: patch.protocol === 'anthropic' || patch.protocol === 'openai' ? patch.protocol : all[slot].protocol,
    baseUrl: typeof patch.baseUrl === 'string' && patch.baseUrl.trim() ? patch.baseUrl.trim() : all[slot].baseUrl,
    model: typeof patch.model === 'string' && patch.model.trim() ? patch.model.trim() : all[slot].model,
  }
  all[slot] = next
  fs.writeFileSync(file(), JSON.stringify(all, null, 2))
  return next
}

const keySlot = (slot: Slot) => `llm-${slot}`
export const getSlotKey = (slot: Slot): string | null => getKey(keySlot(slot))
export const hasSlotKey = (slot: Slot): boolean => !!getSlotKey(slot)
export const saveSlotKey = (slot: Slot, key: string) => setKey(keySlot(slot), key)

/** Full request endpoint for a config, from its base URL + protocol convention. */
export function endpointOf(cfg: ModelConfig): string {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  return cfg.protocol === 'anthropic' ? `${base}/v1/messages` : `${base}/chat/completions`
}

/** One-time migration: the pre-universal build stored the key under `deepseek`. */
export function migrateLegacyKey() {
  if (!getKey('llm-main')) {
    const legacy = getKey('deepseek')
    if (legacy) setKey('llm-main', legacy)
  }
}
