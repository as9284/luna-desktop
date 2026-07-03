import fs from 'node:fs'
import path from 'node:path'

/**
 * Skills are plain Markdown files (`skills/<name>.md`) with a tiny YAML-ish frontmatter
 * carrying `name` + `description`. The description shows in Luna's prompt so she knows the
 * skill exists; the body is loaded on demand via use_skill.
 */

export interface Skill {
  name: string
  description: string
  body: string
}

export function serializeSkill(s: Skill): string {
  return `---\nname: ${s.name}\ndescription: ${s.description.replace(/\n/g, ' ')}\n---\n\n${s.body.trim()}\n`
}

/** Parse a SKILL.md file; falls back to the filename for name and empty description. */
export function parseSkill(text: string, fallbackName: string): Skill {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { name: fallbackName, description: '', body: text.trim() }
  const front = m[1]
  const body = m[2].trim()
  const field = (key: string) => {
    const fm = front.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'))
    return fm ? fm[1].trim().replace(/^["']|["']$/g, '') : ''
  }
  return { name: field('name') || fallbackName, description: field('description'), body }
}

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,48}$/

/** A safe skill filename (kebab-case) or null if the name is unusable. */
export function normalizeSkillName(name: string): string | null {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return SKILL_NAME.test(slug) ? slug : null
}

export function listSkills(dir: string): Skill[] {
  let names: string[]
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
  const skills: Skill[] = []
  for (const file of names) {
    try {
      const text = fs.readFileSync(path.join(dir, file), 'utf8')
      skills.push(parseSkill(text, file.replace(/\.md$/, '')))
    } catch {
      // skip an unreadable skill file rather than failing the whole list
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

export function readSkill(dir: string, name: string): Skill | null {
  const slug = normalizeSkillName(name)
  if (!slug) return null
  try {
    return parseSkill(fs.readFileSync(path.join(dir, `${slug}.md`), 'utf8'), slug)
  } catch {
    return null
  }
}
