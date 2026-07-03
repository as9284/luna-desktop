import { BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { createSoul, type IdentityFile, type Profile, type Soul } from './core'
import { lunaWorkspace } from '../luna'

/**
 * Luna's identity, wired to the real workspace. Backed by files in `<workspace>/System`.
 * Exposes the composed identity prompt (for the chat loop), the use_skill / remember tools,
 * and the editor IPC that powers the Settings "Luna" panel.
 */

let soul: Soul | null = null
function get(): Soul {
  if (!soul) soul = createSoul({ dir: path.join(lunaWorkspace(), 'System') })
  return soul
}

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

/** The full system prompt Luna runs on: soul + rules + skills index + memory. */
export function composeIdentity(): string {
  return get().composeIdentity()
}

/* ---------------- tools ---------------- */

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
})

export const SOUL_TOOL_NAMES = new Set(['use_skill', 'remember'])

export const SOUL_TOOLS = [
  fn(
    'use_skill',
    'Load the full playbook for one of your skills by name. Call this when a task matches a skill listed in your context, then follow the returned instructions.',
    { name: { type: 'string' } },
    ['name'],
  ),
  fn(
    'remember',
    'Save a durable fact about the user to long-term memory (their name, preferences, ongoing projects, decisions, how they like to work). Recalled at the start of future chats. Use sparingly — only things worth keeping.',
    { note: { type: 'string' } },
    ['note'],
  ),
]

export async function runSoulTool(name: string, argsJson: string): Promise<string> {
  const s = get()
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(argsJson || '{}')
  } catch {
    return JSON.stringify({ error: 'Malformed tool arguments.' })
  }
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')

  if (name === 'use_skill') {
    const skill = s.skill(str('name'))
    return skill
      ? JSON.stringify({ skill: skill.name, instructions: skill.body })
      : JSON.stringify({ error: 'No skill by that name. Use one of the skill names listed in your context.' })
  }
  if (name === 'remember') {
    const r = s.remember(str('note'))
    if (r.ok) broadcast('soul:memory-changed', null)
    return JSON.stringify(r.ok ? { ok: true, remembered: str('note') } : { error: r.error })
  }
  return JSON.stringify({ error: `Unknown tool: ${name}` })
}

/* ---------------- editor IPC ---------------- */

const isFile = (f: unknown): f is IdentityFile => f === 'soul' || f === 'agents' || f === 'memory'

export function registerSoul() {
  get().ensureSeeded()
  ipcMain.handle('soul:get', (_e, f: unknown) => (isFile(f) ? get().read(f) : ''))
  ipcMain.handle('soul:save', (_e, f: unknown, content: string) => {
    if (isFile(f)) get().write(f, typeof content === 'string' ? content : '')
    return true
  })
  ipcMain.handle('soul:reset', (_e, f: unknown) => {
    if (!isFile(f)) return ''
    get().reset(f)
    broadcast('soul:memory-changed', null)
    return get().read(f)
  })
  ipcMain.handle('soul:skills', () => {
    const s = get()
    const builtins = new Set(s.builtinSkillNames())
    return s.skills().map((sk) => ({ name: sk.name, description: sk.description, builtin: builtins.has(sk.name) }))
  })
  ipcMain.handle('soul:skill-get', (_e, name: string) => get().skill(String(name)))
  ipcMain.handle('soul:skill-save', (_e, name: string, content: string) => get().writeSkill(String(name), typeof content === 'string' ? content : ''))
  ipcMain.handle('soul:skill-delete', (_e, name: string) => get().deleteSkill(String(name)))
  ipcMain.handle('soul:skill-reset', (_e, name: string) => get().resetSkill(String(name)))
  ipcMain.handle('soul:skills-restore', () => ({ ok: true, count: get().restoreBuiltinSkills() }))
  ipcMain.handle('soul:open-folder', () => {
    shell.openPath(get().dir)
    return true
  })
  ipcMain.handle('soul:profile-get', () => get().getProfile())
  ipcMain.handle('soul:profile-set', (_e, patch: Partial<Profile>) => get().setProfile(patch ?? {}))
}
