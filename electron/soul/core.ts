import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_AGENTS, DEFAULT_MEMORY, DEFAULT_SKILLS, DEFAULT_SOUL } from './defaults'
import { listSkills, normalizeSkillName, parseSkill, readSkill, serializeSkill, type Skill } from './skills'

/**
 * Luna's identity, backed by editable files in a directory (in production `<workspace>/System`).
 * The directory is injected, so the whole thing runs and is tested under plain Node.
 *
 * Files: SOUL.md (personality), AGENTS.md (operating rules), MEMORY.md (what she remembers),
 * skills/<name>.md (loadable playbooks). Seeded on first run; only missing files are written,
 * so user edits always survive.
 */

export type IdentityFile = 'soul' | 'agents' | 'memory'
const FILE: Record<IdentityFile, string> = { soul: 'SOUL.md', agents: 'AGENTS.md', memory: 'MEMORY.md' }
const DEFAULT: Record<IdentityFile, string> = { soul: DEFAULT_SOUL, agents: DEFAULT_AGENTS, memory: DEFAULT_MEMORY }

/** User-declared personalization (distinct from MEMORY.md, which is what Luna learns). */
export interface Profile {
  /** the user's actual name */
  name: string
  /** what Luna should call them (nickname/handle); falls back to name */
  callYou: string
  /** a short about-them she always keeps in context */
  about: string
  address: 'casual' | 'formal' | 'minimal'
  wit: 'subtle' | 'balanced' | 'sharp'
  length: 'brief' | 'balanced' | 'thorough'
  format: 'lists' | 'prose' | 'auto'
  /** free-text standing "always / never" instructions */
  customInstructions: string
}

export const DEFAULT_PROFILE: Profile = {
  name: '', callYou: '', about: '', address: 'casual', wit: 'balanced', length: 'balanced', format: 'auto', customInstructions: '',
}

/** Behavioral modifier lines from the profile (empty when everything is on its default). */
function preferenceLines(p: Profile): string[] {
  const lines: string[] = []
  if (p.address === 'formal') lines.push('Address them in a polished, formal register (an honorific like "Sir"/"Ma\'am" or "Mr./Ms.—" fits).')
  else if (p.address === 'minimal') lines.push('Rarely address them by name — only when it genuinely matters.')
  else lines.push('Address them casually and naturally, by name or handle — sparingly, not in every message.')
  if (p.wit === 'subtle') lines.push('Keep the wit light: mostly straight and efficient, with the occasional dry aside.')
  else if (p.wit === 'sharp') lines.push('Let the deadpan and dry sarcasm run hotter — more of a character — while staying genuinely useful and never cruel.')
  if (p.length === 'brief') lines.push('Default to brief answers; expand only when asked.')
  else if (p.length === 'thorough') lines.push('Default to thorough, well-developed answers.')
  if (p.format === 'lists') lines.push('Prefer tight lists and structure over long prose.')
  else if (p.format === 'prose') lines.push('Prefer flowing prose; use lists only when clearly better.')
  return lines
}

const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function createSoul(cfg: { dir: string }) {
  const skillsDir = path.join(cfg.dir, 'skills')
  const profilePath = path.join(cfg.dir, 'profile.json')
  const pathOf = (f: IdentityFile) => path.join(cfg.dir, FILE[f])

  const getProfile = (): Profile => {
    try {
      const raw = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
      return { ...DEFAULT_PROFILE, ...raw }
    } catch {
      return { ...DEFAULT_PROFILE }
    }
  }
  const setProfile = (patch: Partial<Profile>): Profile => {
    const next = { ...getProfile(), ...patch }
    fs.mkdirSync(cfg.dir, { recursive: true })
    fs.writeFileSync(profilePath, JSON.stringify(next, null, 2))
    return next
  }

  const ensureSeeded = () => {
    fs.mkdirSync(skillsDir, { recursive: true })
    for (const f of Object.keys(FILE) as IdentityFile[]) {
      if (!fs.existsSync(pathOf(f))) fs.writeFileSync(pathOf(f), DEFAULT[f])
    }
    // seed each default skill only if that skill file is absent (updates can add new ones
    // without overwriting the user's edits to existing skills)
    for (const s of DEFAULT_SKILLS) {
      const file = path.join(skillsDir, `${s.name}.md`)
      if (!fs.existsSync(file)) fs.writeFileSync(file, serializeSkill(s))
    }
  }

  const read = (f: IdentityFile): string => {
    try {
      return fs.readFileSync(pathOf(f), 'utf8')
    } catch {
      return DEFAULT[f]
    }
  }

  const write = (f: IdentityFile, content: string) => {
    fs.mkdirSync(cfg.dir, { recursive: true })
    fs.writeFileSync(pathOf(f), content)
  }

  const reset = (f: IdentityFile) => write(f, DEFAULT[f])

  /** Strip MEMORY.md down to its actual remembered lines (drop the header + HTML comment). */
  const memoryBody = (): string => {
    const lines = read('memory')
      .split('\n')
      .filter((l) => !/^#\s/.test(l) && !/^<!--/.test(l.trim()) && l.trim() !== '')
    return lines.join('\n').trim()
  }

  const remember = (note: string): { ok: boolean; error?: string } => {
    const clean = note.trim().replace(/\s+/g, ' ')
    if (!clean) return { ok: false, error: 'Nothing to remember.' }
    ensureSeeded()
    const existing = read('memory')
    const entry = `- ${stamp()} — ${clean}`
    // insert newest-first, right after the header/comment block
    const lines = existing.split('\n')
    let insertAt = lines.length
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('- ')) { insertAt = i; break }
      if (i === lines.length - 1) insertAt = lines.length
    }
    lines.splice(insertAt, 0, entry)
    write('memory', lines.join('\n').replace(/\n{3,}/g, '\n\n'))
    return { ok: true }
  }

  const skills = (): Skill[] => listSkills(skillsDir)

  const skill = (name: string): Skill | null => readSkill(skillsDir, name)

  const writeSkill = (name: string, content: string): { ok: boolean; error?: string } => {
    const slug = normalizeSkillName(name)
    if (!slug) return { ok: false, error: 'Invalid skill name (use letters, numbers, hyphens).' }
    fs.mkdirSync(skillsDir, { recursive: true })
    // let the caller pass either raw frontmatter'd markdown or a bare body
    const text = content.trimStart().startsWith('---') ? content : serializeSkill(parseSkill(content, slug))
    fs.writeFileSync(path.join(skillsDir, `${slug}.md`), text)
    return { ok: true }
  }

  const deleteSkill = (name: string): boolean => {
    const slug = normalizeSkillName(name)
    if (!slug) return false
    try {
      fs.unlinkSync(path.join(skillsDir, `${slug}.md`))
      return true
    } catch {
      return false
    }
  }

  /** The built-in (default-seeded) skills, by their canonical name. */
  const builtinByName = new Map(DEFAULT_SKILLS.map((s) => [s.name, s]))
  const builtinSkillNames = (): string[] => DEFAULT_SKILLS.map((s) => s.name)
  const isBuiltinSkill = (name: string): boolean => builtinByName.has(normalizeSkillName(name) ?? '')

  /** Overwrite one built-in skill with its current default. Refuses user-created skills. */
  const resetSkill = (name: string): { ok: boolean; error?: string } => {
    const def = builtinByName.get(normalizeSkillName(name) ?? '')
    if (!def) return { ok: false, error: 'Not a built-in skill.' }
    fs.mkdirSync(skillsDir, { recursive: true })
    fs.writeFileSync(path.join(skillsDir, `${def.name}.md`), serializeSkill(def))
    return { ok: true }
  }

  /** Refresh every built-in skill to its latest default (user-created skills are untouched). */
  const restoreBuiltinSkills = (): number => {
    fs.mkdirSync(skillsDir, { recursive: true })
    for (const s of DEFAULT_SKILLS) fs.writeFileSync(path.join(skillsDir, `${s.name}.md`), serializeSkill(s))
    return DEFAULT_SKILLS.length
  }

  /** The "# The user" block: who they are (profile) + what Luna has learned (memory). */
  const userSection = (p: Profile): string => {
    const bits: string[] = ['# The user']
    const call = p.callYou.trim() || p.name.trim()
    if (p.name.trim() && p.callYou.trim() && p.callYou.trim() !== p.name.trim()) {
      bits.push(`Their name is ${p.name.trim()}. Call them "${p.callYou.trim()}".`)
    } else if (call) {
      bits.push(`Call them "${call}".`)
    }
    if (p.about.trim()) bits.push(`About them: ${p.about.trim()}`)
    bits.push('', '## What you remember', memoryBody() || 'Nothing yet — this is a fresh slate. Learn as you go.')
    return bits.join('\n')
  }

  /** Assemble the full system prompt: soul + rules + preferences + skills index + the user. */
  const composeIdentity = (): string => {
    ensureSeeded()
    const p = getProfile()
    const prefs = preferenceLines(p)
    const skillLines = skills().map((s) => `- ${s.name} — ${s.description}`).join('\n')

    const blocks = [read('soul').trim(), read('agents').trim()]
    if (prefs.length) blocks.push(['# Preferences', ...prefs.map((l) => `- ${l}`)].join('\n'))
    if (p.customInstructions.trim()) blocks.push(['# Standing instructions from the user', p.customInstructions.trim()].join('\n'))
    blocks.push(
      [
        '# Your skills',
        'When a task clearly matches one, call use_skill(name) to load its full playbook, then follow it.',
        skillLines || '(no skills installed)',
      ].join('\n'),
    )
    blocks.push(userSection(p))
    return blocks.join('\n\n')
  }

  return {
    dir: cfg.dir, skillsDir, ensureSeeded, read, write, reset, remember, memoryBody,
    skills, skill, writeSkill, deleteSkill, getProfile, setProfile, composeIdentity,
    builtinSkillNames, isBuiltinSkill, resetSkill, restoreBuiltinSkills,
  }
}

export type Soul = ReturnType<typeof createSoul>
