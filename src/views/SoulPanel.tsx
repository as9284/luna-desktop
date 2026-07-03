import { useEffect, useState, type ReactNode } from 'react'
import { FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button, Field, IconButton, Input, Segmented, Textarea, toast } from '../ui'

const seg = <T extends string>(ids: readonly T[]) => ids.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }))

/** A bordered "editor" frame: a header strip (filename + char count) over a tall textarea. */
function DocBox({ name, meta, children }: { name: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="soul-doc">
      <div className="soul-doc-head">
        <span className="soul-doc-name">{name}</span>
        {meta != null && <span className="soul-doc-meta">{meta}</span>}
      </div>
      {children}
    </div>
  )
}
const chars = (s: string) => `${s.length.toLocaleString()} chars`

/** The "You" profile: name, what she calls you, about-you, and the personality/response dials. */
function ProfileEditor() {
  const [p, setP] = useState<LunaProfile | null>(null)
  const [saved, setSaved] = useState('')

  useEffect(() => {
    let live = true
    window.api?.soul?.getProfile().then((pr) => {
      if (!live) return
      setP(pr)
      setSaved(JSON.stringify(pr))
    })
    return () => {
      live = false
    }
  }, [])

  if (!p) return null
  const set = (patch: Partial<LunaProfile>) => setP({ ...p, ...patch })
  const dirty = JSON.stringify(p) !== saved
  const save = async () => {
    const r = await window.api?.soul?.setProfile(p)
    if (r) {
      setP(r)
      setSaved(JSON.stringify(r))
    }
    toast('Profile saved')
  }

  return (
    <div className="soul-editor">
      <div className="model-grid">
        <Field label="Your name">
          <Input value={p.name} placeholder="optional" onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="What Luna calls you">
          <Input value={p.callYou} placeholder="name, handle, callsign…" onChange={(e) => set({ callYou: e.target.value })} />
        </Field>
      </div>
      <Field label="About you" help="Role, what you're building, expertise — she keeps this in mind.">
        <Textarea className="soul-text short scroll-y" value={p.about} onChange={(e) => set({ about: e.target.value })} />
      </Field>
      <div className="model-grid">
        <Field label="How she addresses you">
          <Segmented options={seg(['casual', 'formal', 'minimal'] as const)} value={p.address} onChange={(id) => set({ address: id as LunaProfile['address'] })} />
        </Field>
        <Field label="Wit level">
          <Segmented options={seg(['subtle', 'balanced', 'sharp'] as const)} value={p.wit} onChange={(id) => set({ wit: id as LunaProfile['wit'] })} />
        </Field>
      </div>
      <div className="model-grid">
        <Field label="Answer length">
          <Segmented options={seg(['brief', 'balanced', 'thorough'] as const)} value={p.length} onChange={(id) => set({ length: id as LunaProfile['length'] })} />
        </Field>
        <Field label="Format">
          <Segmented options={seg(['lists', 'auto', 'prose'] as const)} value={p.format} onChange={(id) => set({ format: id as LunaProfile['format'] })} />
        </Field>
      </div>
      <Field label="Custom instructions" help="Standing 'always / never' preferences, in your words.">
        <Textarea
          className="soul-text short scroll-y"
          value={p.customInstructions}
          placeholder="e.g. Always show your reasoning. Never use emoji. Assume I'm a developer."
          onChange={(e) => set({ customInstructions: e.target.value })}
        />
      </Field>
      <div className="row-inline">
        <Button variant="primary" small disabled={!dirty} onClick={save}>Save</Button>
        {dirty && <span className="soul-dirty">Unsaved changes</span>}
      </div>
    </div>
  )
}

/** Editor for one of Luna's identity files (soul / rules / memory). */
function FileEditor({
  file,
  label,
  filename,
  hint,
  resetLabel,
}: {
  file: SoulFile
  label: string
  filename: string
  hint: string
  resetLabel: string
}) {
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    let live = true
    window.api?.soul?.get(file).then((c) => {
      if (!live) return
      setContent(c)
      setSaved(c)
    })
    return () => {
      live = false
    }
  }, [file])

  const dirty = content !== saved
  const save = async () => {
    await window.api?.soul?.save(file, content)
    setSaved(content)
    toast(`${label} saved`)
  }
  const reset = async () => {
    const c = await window.api?.soul?.reset(file)
    if (typeof c === 'string') {
      setContent(c)
      setSaved(c)
    }
    toast(`${label} reset`)
  }

  return (
    <div className="soul-editor">
      <p className="soul-hint">{hint}</p>
      <DocBox name={filename} meta={chars(content)}>
        <Textarea className="soul-text scroll-y" value={content} spellCheck={false} onChange={(e) => setContent(e.target.value)} />
      </DocBox>
      <div className="row-inline">
        <Button variant="primary" small disabled={!dirty} onClick={save}>Save</Button>
        <Button variant="secondary" small onClick={reset}>{resetLabel}</Button>
        {dirty && <span className="soul-dirty">Unsaved changes</span>}
      </div>
    </div>
  )
}

const slug = (n: string) => n.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function SkillsEditor() {
  const [skills, setSkills] = useState<SoulSkillMeta[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [body, setBody] = useState('')
  const [saved, setSaved] = useState('')
  const [confirmRestore, setConfirmRestore] = useState(false)

  const load = () => window.api?.soul?.skills().then((s) => setSkills(s ?? [])).catch(() => {})
  useEffect(() => { load() }, [])

  const open = async (name: string) => {
    setCreating(false)
    setNewName('')
    setSel(name)
    const s = await window.api?.soul?.skillGet(name)
    setBody(s?.body ?? '')
    setSaved(s?.body ?? '')
  }
  const startNew = () => {
    setCreating(true)
    setSel(null)
    setNewName('')
    setBody('')
    setSaved('')
  }
  const editing = creating || sel !== null
  const dirty = creating ? !!(newName.trim() && body.trim()) : body !== saved

  const save = async () => {
    const name = creating ? newName : sel
    if (!name) return
    const r = await window.api?.soul?.skillSave(name, body)
    if (r && !r.ok) {
      toast(r.error || 'Could not save skill')
      return
    }
    toast('Skill saved')
    await load()
    if (creating) await open(slug(newName))
    else setSaved(body)
  }
  const del = async () => {
    if (!sel) return
    await window.api?.soul?.skillDelete(sel)
    setSel(null)
    setBody('')
    setSaved('')
    await load()
    toast('Skill deleted')
  }
  const resetOne = async () => {
    if (!sel) return
    const r = await window.api?.soul?.skillReset(sel)
    if (r && !r.ok) { toast(r.error || 'Could not reset skill'); return }
    await open(sel)
    await load()
    toast('Skill reset to default')
  }
  const restoreAll = async () => {
    const r = await window.api?.soul?.skillsRestore()
    setConfirmRestore(false)
    await load()
    if (sel) await open(sel)
    toast(r ? `Updated ${r.count} built-in skills` : 'Updated built-in skills')
  }

  const selBuiltin = !creating && !!skills.find((s) => s.name === sel)?.builtin

  return (
    <div className="skills-editor">
      <div className="skills-bar">
        <button className="mini-btn wide" onClick={startNew}><Plus size={14} /> New skill</button>
        <button className="mini-btn wide" onClick={() => setConfirmRestore(true)}><RefreshCw size={14} /> Update built-ins</button>
        <button className="mini-btn wide" onClick={() => window.api?.soul?.openFolder()}><FolderOpen size={14} /> Open folder</button>
      </div>

      {confirmRestore && (
        <div className="skill-confirm">
          <span>Reset all built-in skills to their latest shipped versions? Skills you created or renamed are untouched.</span>
          <div className="row-inline">
            <Button variant="primary" small onClick={restoreAll}>Update</Button>
            <Button variant="secondary" small onClick={() => setConfirmRestore(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="skill-list scroll-y">
        {skills.map((s) => (
          <button key={s.name} className={'skill-row' + (s.name === sel ? ' on' : '')} onClick={() => open(s.name)}>
            <span className="skill-name">{s.name}</span>
            <span className="skill-desc">{s.description}</span>
          </button>
        ))}
        {skills.length === 0 && <div className="soul-dirty">No skills yet.</div>}
      </div>

      {editing && (
        <div className="soul-editor">
          {creating && (
            <Input placeholder="skill-name (letters, numbers, hyphens)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          )}
          <DocBox name={creating ? newName.trim() || 'new-skill' : sel} meta={chars(body)}>
            <Textarea
              className="soul-text scroll-y"
              placeholder="The step-by-step playbook Luna follows when she loads this skill…"
              value={body}
              spellCheck={false}
              onChange={(e) => setBody(e.target.value)}
            />
          </DocBox>
          <div className="row-inline">
            <Button variant="primary" small disabled={!dirty} onClick={save}>Save skill</Button>
            {selBuiltin && <Button variant="secondary" small onClick={resetOne}>Reset to default</Button>}
            {!creating && sel && (
              <IconButton label="Delete skill" className="row-del" onClick={del}><Trash2 size={15} /></IconButton>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SoulPanel() {
  const [tab, setTab] = useState<'you' | 'soul' | 'rules' | 'memory' | 'skills'>('you')
  return (
    <div className="soul-panel">
      <Segmented
        options={[
          { id: 'you', label: 'You' },
          { id: 'soul', label: 'Soul' },
          { id: 'rules', label: 'Rules' },
          { id: 'memory', label: 'Memory' },
          { id: 'skills', label: 'Skills' },
        ]}
        value={tab}
        onChange={(id) => setTab(id as typeof tab)}
      />
      {tab === 'you' && <ProfileEditor />}
      {tab === 'soul' && (
        <FileEditor file="soul" label="Soul" filename="SOUL.md" hint="Her personality and voice — who Luna is." resetLabel="Reset to default" />
      )}
      {tab === 'rules' && (
        <FileEditor file="agents" label="Rules" filename="AGENTS.md" hint="Standing orders she always follows." resetLabel="Reset to default" />
      )}
      {tab === 'memory' && (
        <FileEditor file="memory" label="Memory" filename="MEMORY.md" hint="What she remembers about you and your work." resetLabel="Clear memory" />
      )}
      {tab === 'skills' && <SkillsEditor />}
    </div>
  )
}
