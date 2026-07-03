/**
 * Backend harness for Luna's identity system (soul / rules / skills / memory).
 * Run: npx tsx scripts/test-soul.mts
 *
 * Uses a throwaway System dir to verify seeding (and that user edits survive re-seed),
 * identity composition, autonomous memory, and the full skill lifecycle.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createSoul } from '../electron/soul/core'
import { parseSkill, serializeSkill } from '../electron/soul/skills'
import { DEFAULT_SKILLS } from '../electron/soul/defaults'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`) }
}
const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`)

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-soul-'))
const soul = createSoul({ dir: DIR })

section('Seeding')
soul.ensureSeeded()
ok('SOUL.md / AGENTS.md / MEMORY.md are written', ['SOUL.md', 'AGENTS.md', 'MEMORY.md'].every((f) => fs.existsSync(path.join(DIR, f))))
ok('every default skill is seeded', DEFAULT_SKILLS.every((s) => fs.existsSync(path.join(DIR, 'skills', `${s.name}.md`))))
ok(`skills() lists all ${DEFAULT_SKILLS.length} defaults`, soul.skills().length === DEFAULT_SKILLS.length)

section('Re-seed preserves user edits')
soul.write('soul', '# My custom soul\nBe extremely terse.')
soul.ensureSeeded() // should NOT clobber the edited file
ok('edited SOUL.md survives a re-seed', soul.read('soul').includes('extremely terse'))
{
  // deleting one skill then re-seeding restores just that one (updates can add new defaults)
  fs.unlinkSync(path.join(DIR, 'skills', 'writing.md'))
  soul.ensureSeeded()
  ok('a missing default skill is re-seeded', fs.existsSync(path.join(DIR, 'skills', 'writing.md')))
}
soul.reset('soul') // restore for the rest of the tests

section('Identity composition')
{
  const id = soul.composeIdentity()
  ok('includes the soul (personality)', /personal AI/i.test(id))
  ok('includes the operating rules', /research-heavy/i.test(id))
  ok('includes the skills index with descriptions', id.includes('deep-research —') && id.includes('summarize —'))
  ok('empty memory reads as a fresh slate', /fresh slate|Nothing yet/i.test(id))
}

section('Autonomous memory')
{
  const r = soul.remember('The user is named Ada and prefers concise answers.')
  ok('remember() succeeds', r.ok)
  ok('memoryBody now contains the fact', /named Ada/.test(soul.memoryBody()))
  ok('composeIdentity now surfaces the memory', /named Ada/.test(soul.composeIdentity()))
  ok('…and no longer says the slate is empty', !/fresh slate/i.test(soul.composeIdentity()))
  soul.remember('The user is building Luna Desktop.')
  const body = soul.memoryBody()
  ok('newest memory is on top', body.indexOf('Luna Desktop') < body.indexOf('named Ada'))
  ok('empty remember is rejected', !soul.remember('   ').ok)
}

section('Skill lifecycle')
{
  const ds = soul.skill('deep-research')
  ok('reads a default skill body', !!ds && /Cross-check every load-bearing claim/.test(ds!.body))
  ok('unknown skill returns null', soul.skill('does-not-exist') === null)

  const w = soul.writeSkill('My Custom Skill', 'Always do the custom thing first.')
  ok('writeSkill accepts a bare body + kebabs the name', w.ok)
  const custom = soul.skill('my-custom-skill')
  ok('the new skill is readable', !!custom && custom!.body === 'Always do the custom thing first.')
  ok('it appears in skills()', soul.skills().some((s) => s.name === 'my-custom-skill'))

  ok('an unusable skill name is rejected', !soul.writeSkill('!!!', 'x').ok)

  ok('deleteSkill removes it', soul.deleteSkill('my-custom-skill') && soul.skill('my-custom-skill') === null)
}

section('Design skill')
{
  const d = soul.skill('design')
  ok('the universal design skill is seeded', !!d)
  ok('it covers documents, UI, and export_pdf', !!d && /export_pdf/.test(d!.body) && /Design fundamentals/i.test(d!.body))
  ok('composeIdentity lists it in the skills index', /design —/.test(soul.composeIdentity()))
}

section('Built-in skill update mechanism')
{
  ok('a default skill is flagged built-in', soul.isBuiltinSkill('coding') && soul.isBuiltinSkill('design'))
  soul.writeSkill('my-tool', 'do the thing')
  ok('a user-created skill is NOT built-in', !soul.isBuiltinSkill('my-tool'))

  // per-skill reset restores an edited built-in, and refuses non-built-ins
  soul.writeSkill('coding', 'HACKED — not the real playbook')
  ok('an edited built-in reads back the edit', /HACKED/.test(soul.skill('coding')!.body))
  ok('resetSkill restores the shipped default', soul.resetSkill('coding').ok && !/HACKED/.test(soul.skill('coding')!.body) && /Nail the goal/.test(soul.skill('coding')!.body))
  ok('resetSkill refuses a user-created skill', !soul.resetSkill('my-tool').ok)

  // bulk restore refreshes every built-in but leaves user skills alone
  soul.writeSkill('writing', 'edited again')
  soul.writeSkill('design', 'edited too')
  const n = soul.restoreBuiltinSkills()
  ok('restoreBuiltinSkills returns the default count', n === DEFAULT_SKILLS.length)
  ok('all built-ins are back to defaults', !/edited again/.test(soul.skill('writing')!.body) && /Design fundamentals/i.test(soul.skill('design')!.body))
  ok('a user-created skill survives a bulk restore', soul.skill('my-tool')?.body === 'do the thing')
  soul.deleteSkill('my-tool')
}

section('You profile → identity injection')
{
  ok('profile defaults are all-empty/neutral', soul.getProfile().name === '' && soul.getProfile().wit === 'balanced')
  soul.setProfile({ name: 'Ada Lovelace', callYou: 'Ada', about: 'A developer building Luna Desktop.' })
  const id = soul.composeIdentity()
  ok('name + what-to-call surface in the prompt', /Their name is Ada Lovelace/.test(id) && /Call them "Ada"/.test(id))
  ok('about-you surfaces', /building Luna Desktop/.test(id))
  ok('a set profile persists across reloads', createSoul({ dir: DIR }).getProfile().callYou === 'Ada')

  soul.setProfile({ wit: 'sharp', length: 'brief', format: 'lists', address: 'formal', customInstructions: 'Never use emoji.' })
  const id2 = soul.composeIdentity()
  ok('sharp wit adds a modifier', /run hotter/i.test(id2))
  ok('brief length adds a modifier', /brief answers/i.test(id2))
  ok('formal address adds a modifier', /formal register/i.test(id2))
  ok('custom instructions are injected verbatim', /Never use emoji\./.test(id2))

  // back to defaults → no preference noise in the prompt
  soul.setProfile({ wit: 'balanced', length: 'balanced', format: 'auto', address: 'casual', customInstructions: '' })
  ok('default dials add no length/wit modifier lines', !/run hotter/i.test(soul.composeIdentity()) && !/thorough, well-developed/i.test(soul.composeIdentity()))
}

section('SKILL.md parse / serialize round-trip')
{
  const original = { name: 'demo', description: 'A demo skill, with, commas.', body: 'Line one.\nLine two.' }
  const round = parseSkill(serializeSkill(original), 'fallback')
  ok('name survives', round.name === 'demo')
  ok('description survives', round.description === 'A demo skill, with, commas.')
  ok('body survives', round.body === 'Line one.\nLine two.')
  ok('a body-only file falls back to the filename', parseSkill('just a body', 'fallback').name === 'fallback')
}

section('File read / write / reset')
{
  soul.write('agents', 'custom rules')
  ok('write then read round-trips', soul.read('agents') === 'custom rules')
  soul.reset('agents')
  ok('reset restores the default rules', /research-heavy/i.test(soul.read('agents')))
}

console.log(`\n\x1b[1mResults: \x1b[32m${pass} passed\x1b[0m, ${fail ? `\x1b[31m${fail} failed\x1b[0m` : '0 failed'}`)
try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
