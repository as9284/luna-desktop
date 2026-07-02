import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { useOrbit, type ProjectStatus } from '../store/orbit'
import { useMeetings, type MeetingSession } from '../store/meetings'
import { goHome } from '../lib/router'
import { Badge, Button, Checkbox, ConfirmModal, IconButton, Input, Modal, Segmented, Slider, Textarea, toast } from '../ui'
import './orbit.css'

type Tab = 'tasks' | 'notes' | 'projects' | 'meeting' | 'write'

const fmt = (ts: number) =>
  new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const XIcon = () => (
  <svg viewBox="0 0 14 14">
    <path d="M4 4l6 6M10 4l-6 6" />
  </svg>
)

function Empty({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="panel-empty">
      <div className="empty-orb" />
      <b>{label}</b>
      <span>{hint}</span>
    </div>
  )
}

function Tasks() {
  const tasks = useOrbit((s) => s.tasks)
  const addTask = useOrbit((s) => s.addTask)
  const toggleTask = useOrbit((s) => s.toggleTask)
  const removeTask = useOrbit((s) => s.removeTask)
  const clearDone = useOrbit((s) => s.clearDone)
  const [text, setText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const open = tasks.filter((t) => !t.done).length
  const done = tasks.length - open
  const submit = () => {
    const t = text.trim()
    if (!t) return
    addTask(t)
    setText('')
  }

  return (
    <div className="panel">
      <div className="add-row">
        <Input
          placeholder="Add a task…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          style={{ flex: 1 }}
        />
        <Button variant="primary" small onClick={submit} disabled={!text.trim()}>
          Add
        </Button>
      </div>

      {tasks.length === 0 ? (
        <Empty label="No tasks yet" hint="Add your first task above." />
      ) : (
        <ul className="task-list">
          {tasks.map((t) => (
            <li key={t.id} className={'task' + (t.done ? ' done' : '')}>
              <Checkbox checked={t.done} onChange={() => toggleTask(t.id)} label={<span className="task-text">{t.text}</span>} />
              <IconButton label="Delete task" className="row-del" onClick={() => setConfirmDelete(t.id)}>
                <XIcon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {tasks.length > 0 && (
        <div className="panel-foot">
          <span className="count">
            {open} open · {done} done
          </span>
          {done > 0 && (
            <Button variant="ghost" small onClick={clearDone}>
              Clear done
            </Button>
          )}
        </div>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        title="Delete task?"
        message="This task will be permanently deleted."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) removeTask(confirmDelete)
          setConfirmDelete(null)
        }}
      />
    </div>
  )
}

function Notes() {
  const notes = useOrbit((s) => s.notes)
  const addNote = useOrbit((s) => s.addNote)
  const updateNote = useOrbit((s) => s.updateNote)
  const removeNote = useOrbit((s) => s.removeNote)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const current = notes.find((n) => n.id === editing) ?? null

  return (
    <div className="panel">
      <div className="panel-bar">
        <span className="count">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </span>
        <Button variant="secondary" small onClick={() => setEditing(addNote())}>
          New note
        </Button>
      </div>

      {notes.length === 0 ? (
        <Empty label="No notes yet" hint="Capture a thought with New note." />
      ) : (
        <div className="note-grid">
          {notes.map((n) => (
            <button key={n.id} className="note-card" onClick={() => setEditing(n.id)}>
              <b>{n.title || 'Untitled'}</b>
              <p>{n.body || 'Empty note'}</p>
              <i>{fmt(n.ts)}</i>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={!!current}
        onClose={() => setEditing(null)}
        title="Note"
        actions={
          current && (
            <>
              <Button
                variant="danger"
                small
                onClick={() => {
                  setConfirmDelete(current.id)
                  setEditing(null)
                }}
              >
                Delete
              </Button>
              <Button variant="primary" small onClick={() => setEditing(null)}>
                Done
              </Button>
            </>
          )
        }
      >
        {current && (
          <div className="note-edit">
            <Input
              placeholder="Title"
              value={current.title}
              onChange={(e) => updateNote(current.id, { title: e.target.value })}
            />
            <Textarea
              placeholder="Write something…"
              rows={7}
              value={current.body}
              onChange={(e) => updateNote(current.id, { body: e.target.value })}
            />
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!confirmDelete}
        title="Delete note?"
        message="This note will be permanently deleted."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            removeNote(confirmDelete)
            toast('Note deleted')
          }
          setConfirmDelete(null)
        }}
      />
    </div>
  )
}

const NEXT_STATUS: Record<ProjectStatus, ProjectStatus> = { active: 'paused', paused: 'done', done: 'active' }

function Projects() {
  const projects = useOrbit((s) => s.projects)
  const addProject = useOrbit((s) => s.addProject)
  const updateProject = useOrbit((s) => s.updateProject)
  const removeProject = useOrbit((s) => s.removeProject)
  const [text, setText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const submit = () => {
    const t = text.trim()
    if (!t) return
    addProject(t)
    setText('')
  }

  return (
    <div className="panel">
      <div className="add-row">
        <Input
          placeholder="New project…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          style={{ flex: 1 }}
        />
        <Button variant="primary" small onClick={submit} disabled={!text.trim()}>
          Add
        </Button>
      </div>

      {projects.length === 0 ? (
        <Empty label="No projects yet" hint="Track a project and its progress." />
      ) : (
        <div className="proj-list">
          {projects.map((p) => (
            <div key={p.id} className="proj">
              <div className="proj-top">
                <b>{p.name}</b>
                <button
                  className="status-pill"
                  onClick={() => updateProject(p.id, { status: NEXT_STATUS[p.status] })}
                  title="Cycle status"
                >
                  <Badge variant={p.status === 'done' ? 'solid' : 'outline'}>{p.status}</Badge>
                </button>
                <IconButton label="Delete project" className="row-del" onClick={() => setConfirmDelete(p.id)}>
                  <XIcon />
                </IconButton>
              </div>
              <div className="proj-progress">
                <Slider value={p.progress} onChange={(v) => updateProject(p.id, { progress: v })} />
                <span className="pct">{p.progress}%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        title="Delete project?"
        message="This project and its progress will be permanently deleted."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) removeProject(confirmDelete)
          setConfirmDelete(null)
        }}
      />
    </div>
  )
}

function MeetingDetail({
  session,
  onBack,
  onDelete,
}: {
  session: MeetingSession
  onBack: () => void
  onDelete: () => void
}) {
  const a = session.artifacts
  return (
    <div className="m-detail">
      <div className="m-detail-head">
        <button className="m-back" onClick={onBack}>
          ‹ All meetings
        </button>
        <IconButton label="Delete meeting" className="row-del" onClick={onDelete}>
          <XIcon />
        </IconButton>
      </div>
      <h4 className="m-detail-title">{session.title}</h4>
      <div className="m-detail-time">{fmt(session.endedAt ?? session.startedAt)}</div>

      {a && (
        <div className="m-badges">
          <Badge variant="outline">
            {session.entries.length} {session.entries.length === 1 ? 'note' : 'notes'}
          </Badge>
          {a.tasks.length > 0 && (
            <Badge variant="outline">
              {a.tasks.length} {a.tasks.length === 1 ? 'task' : 'tasks'}
            </Badge>
          )}
          {a.project && <Badge variant="outline">{a.project.name}</Badge>}
        </div>
      )}

      {a?.warning && <div className="meeting-warn">{a.warning}</div>}

      {a?.note.content && (
        <div>
          <div className="m-sub">Summary note</div>
          <div className="m-note-title">{a.note.title}</div>
          <pre className="m-note-body">{a.note.content}</pre>
        </div>
      )}

      {a && a.tasks.length > 0 && (
        <div className="m-tasks">
          <div className="m-sub">Tasks created</div>
          <ul>
            {a.tasks.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="m-sub">Captured notes</div>
      <div className="m-detail-entries">
        {session.entries.map((e, i) => (
          <div key={e.id} className="m-detail-entry">
            <span className="m-entry-n">{i + 1}</span>
            <p>{e.content}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function Meeting() {
  const activeSession = useMeetings((s) => s.activeSession)
  const sessions = useMeetings((s) => s.sessions)
  const startSession = useMeetings((s) => s.startSession)
  const addEntry = useMeetings((s) => s.addEntry)
  const discardActive = useMeetings((s) => s.discardActive)
  const endSession = useMeetings((s) => s.endSession)
  const deleteSession = useMeetings((s) => s.deleteSession)

  const addNote = useOrbit((s) => s.addNote)
  const updateNote = useOrbit((s) => s.updateNote)
  const addTask = useOrbit((s) => s.addTask)
  const addProject = useOrbit((s) => s.addProject)

  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState('')
  const [ending, setEnding] = useState(false)
  const [hasKey, setHasKey] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const feedEnd = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    window.api?.hasKey('deepseek').then(setHasKey).catch(() => {})
  }, [])

  const entryCount = activeSession?.entries.length ?? 0
  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entryCount])

  const start = () => {
    if (!startSession(title)) return
    setTitle('')
    requestAnimationFrame(() => draftRef.current?.focus())
  }

  const add = () => {
    if (!addEntry(draft)) return
    setDraft('')
    if (draftRef.current) draftRef.current.style.height = 'auto'
    requestAnimationFrame(() => draftRef.current?.focus())
  }

  const end = async () => {
    const api = window.api
    if (!activeSession || ending || !api) return
    if (activeSession.entries.length === 0) {
      toast('Add at least one note first')
      return
    }
    setEnding(true)
    try {
      const art = await api.summarizeMeeting(
        activeSession.title,
        activeSession.entries.map((e) => e.content),
      )
      const noteId = addNote()
      updateNote(noteId, { title: art.note.title, body: art.note.content })
      art.tasks.forEach((t) => addTask(t))
      if (art.project) addProject(art.project.name)
      endSession({
        createdAt: Date.now(),
        note: { title: art.note.title, content: art.note.content, noteId },
        tasks: art.tasks,
        project: art.project,
        warning: art.warning,
      })
      setDraft('')
      toast(art.warning ? 'Saved your notes to Orbit' : 'Meeting organized into Orbit')
    } catch {
      toast('Could not save meeting')
    } finally {
      setEnding(false)
    }
  }

  const detail = sessions.find((s) => s.id === detailId) ?? null

  return (
    <div className="meeting">
      <div className="meeting-bar">
        {activeSession ? (
          <div className="meeting-live">
            <span className="live-dot" />
            <span className="meeting-live-title">{activeSession.title}</span>
            <span className="count">
              {entryCount} {entryCount === 1 ? 'note' : 'notes'}
            </span>
          </div>
        ) : (
          <span className="count">No active meeting</span>
        )}
        <div className="meeting-bar-actions">
          {activeSession && (
            <Button variant="ghost" small onClick={() => setConfirmDiscard(true)}>
              Discard
            </Button>
          )}
          <Button
            variant="secondary"
            small
            onClick={() => {
              setDetailId(null)
              setHistoryOpen(true)
            }}
          >
            History{sessions.length ? ` · ${sessions.length}` : ''}
          </Button>
        </div>
      </div>

      {!hasKey && (
        <div className="meeting-warn">
          Add an API key in Settings so Luna can organize your notes. You can still capture them now.
        </div>
      )}

      {activeSession ? (
        <div className="meeting-live-body">
          <div className="meeting-feed">
            {entryCount === 0 ? (
              <div className="meeting-feed-empty">
                Type a note below and press Enter — one per key point. Shift+Enter for a new line.
              </div>
            ) : (
              activeSession.entries.map((e, i) => (
                <div key={e.id} className="m-entry">
                  <span className="m-entry-n">{i + 1}</span>
                  <div className="m-entry-body">
                    <p>{e.content}</p>
                    <i>{new Date(e.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</i>
                  </div>
                </div>
              ))
            )}
            <div ref={feedEnd} />
          </div>

          <div className="meeting-composer">
            <div className="meeting-composer-in">
              <textarea
                ref={draftRef}
                className="input m-draft"
                placeholder="Type a note and press Enter…"
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onInput={(e) => {
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = `${Math.min(el.scrollHeight, 132)}px`
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    add()
                  }
                }}
              />
              <Button variant="secondary" small onClick={add} disabled={!draft.trim()}>
                Add
              </Button>
              <Button variant="primary" small onClick={end} disabled={ending}>
                {ending ? 'Organizing…' : 'End & save'}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="meeting-start">
          <div className="empty-orb" />
          <b>Start a meeting</b>
          <span>
            Jot one note per point as it happens. When you end, Luna writes a summary note, pulls out tasks, and groups
            them under a project.
          </span>
          <div className="meeting-start-form">
            <Input
              placeholder="Meeting title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') start()
              }}
            />
            <Button variant="primary" onClick={start} disabled={!title.trim()}>
              Start meeting
            </Button>
          </div>
        </div>
      )}

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={detail ? undefined : 'Meeting history'}>
        {detail ? (
          <MeetingDetail session={detail} onBack={() => setDetailId(null)} onDelete={() => setConfirmDelete(detail.id)} />
        ) : sessions.length === 0 ? (
          <p className="meeting-none">No meetings yet. End one and it lands here.</p>
        ) : (
          <div className="meeting-history">
            {sessions.map((s) => (
              <button key={s.id} className="m-hist-row" onClick={() => setDetailId(s.id)}>
                <span className="m-hist-title">{s.title}</span>
                <span className="m-hist-meta">
                  {fmt(s.endedAt ?? s.startedAt)} · {s.entries.length} {s.entries.length === 1 ? 'note' : 'notes'}
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={confirmDiscard}
        title="Discard meeting?"
        message="The current meeting and all notes captured so far will be discarded. This can't be undone."
        confirmLabel="Discard"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          discardActive()
          setDraft('')
          setConfirmDiscard(false)
        }}
      />

      <ConfirmModal
        open={!!confirmDelete}
        title="Delete meeting?"
        message="Remove this meeting from history. The note, tasks, and project it created in Orbit stay put."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) deleteSession(confirmDelete)
          setConfirmDelete(null)
          setDetailId(null)
        }}
      />
    </div>
  )
}

type WriteStyle = 'email' | 'formal' | 'casual' | 'proofread'

const WRITE_STYLES: { id: WriteStyle; label: string; noteTitle: string; instruction: string }[] = [
  {
    id: 'email',
    label: 'Email',
    noteTitle: 'Email draft',
    instruction:
      "Turn the text into a complete, well-structured email with an appropriate greeting and sign-off. Put an inferred subject on the first line as 'Subject: …'.",
  },
  {
    id: 'formal',
    label: 'Formal',
    noteTitle: 'Formal rewrite',
    instruction: 'Rewrite in a formal, professional tone suitable for business or official communication. Keep the meaning intact.',
  },
  {
    id: 'casual',
    label: 'Casual',
    noteTitle: 'Casual rewrite',
    instruction: 'Rewrite in a relaxed, friendly, conversational tone. Keep the meaning intact.',
  },
  {
    id: 'proofread',
    label: 'Proofread',
    noteTitle: 'Proofread text',
    instruction:
      'Fix grammar, spelling, and punctuation only. Do not change the tone, wording, or structure beyond what corrections require.',
  },
]

function writeSystemPrompt(style: WriteStyle, custom: string): string {
  const s = WRITE_STYLES.find((w) => w.id === style)!
  return [
    "You are a writing assistant. Rewrite the user's text according to the instructions.",
    s.instruction,
    custom.trim() && `Additional instructions: ${custom.trim()}`,
    'Reply with ONLY the rewritten text — no preamble, no explanations, no code fences.',
  ]
    .filter(Boolean)
    .join(' ')
}

function Write() {
  const addNote = useOrbit((s) => s.addNote)
  const updateNote = useOrbit((s) => s.updateNote)

  const [style, setStyle] = useState<WriteStyle>('email')
  const [custom, setCustom] = useState('')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [reqId, setReqId] = useState<string | null>(null)
  const [hasKey, setHasKey] = useState(true)

  useEffect(() => {
    window.api?.hasKey('deepseek').then(setHasKey).catch(() => {})
  }, [])

  const running = !!reqId

  const run = async () => {
    const api = window.api
    const text = input.trim()
    if (!text || running || !api?.chat) return
    const id = crypto.randomUUID()
    setReqId(id)
    setOutput('')
    try {
      await api.chat(
        {
          id,
          messages: [
            { role: 'system', content: writeSystemPrompt(style, custom) },
            { role: 'user', content: text },
          ],
          temperature: 0.3,
          tools: false,
        },
        (token) => setOutput((o) => o + token),
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Rewrite failed')
    } finally {
      setReqId(null)
    }
  }

  const copy = () => {
    navigator.clipboard.writeText(output).then(() => toast('Copied'))
  }

  const saveNote = () => {
    const id = addNote()
    updateNote(id, { title: WRITE_STYLES.find((w) => w.id === style)!.noteTitle, body: output })
    toast('Saved to notes')
  }

  return (
    <div className="panel write">
      {!hasKey && (
        <div className="meeting-warn">Add an API key in Settings so Luna can rewrite your text.</div>
      )}

      <div className="write-controls">
        <Segmented
          options={WRITE_STYLES.map(({ id, label }) => ({ id, label }))}
          value={style}
          onChange={(id) => setStyle(id as WriteStyle)}
        />
        <Input
          placeholder="Optional instructions — e.g. make it shorter…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>

      <div className="write-panes">
        <div className="write-pane">
          <div className="write-pane-head">
            <span className="count">Your text</span>
          </div>
          <Textarea
            placeholder="Paste or write the text to improve…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="write-in"
          />
        </div>

        <div className="write-pane">
          <div className="write-pane-head">
            <span className="count">Rewritten</span>
            {output && !running && (
              <div className="write-out-actions">
                <Button variant="ghost" small onClick={copy}>
                  Copy
                </Button>
                <Button variant="secondary" small onClick={saveNote}>
                  Save as note
                </Button>
              </div>
            )}
          </div>
          <div className={'write-out' + (output ? '' : ' empty')}>
            {output || (running ? 'Writing…' : 'The rewritten text will appear here.')}
          </div>
        </div>
      </div>

      <div className="write-foot">
        {running ? (
          <Button variant="secondary" onClick={() => window.api?.cancelChat?.(reqId!)}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={run} disabled={!input.trim()}>
            Rewrite
          </Button>
        )}
      </div>
    </div>
  )
}

export default function Orbit() {
  const name = useUI((s) => s.module) ?? 'Orbit'
  const [tab, setTab] = useState<Tab>('tasks')

  return (
    <div className="view view--orbit" id="module">
      <div className="orbit-bg">
        <div className="glow" />
      </div>

      <header className="orbit-head">
        <button className="backbtn" onClick={goHome}>
          <svg viewBox="0 0 14 14">
            <path d="M9 3l-4 4 4 4" />
          </svg>
          System
        </button>

        <div className="orbit-row">
          <div className="orbit-id">
            <span className="orbit-orb" />
            <div className="orbit-id-txt">
              <h1>{name}</h1>
              <p>tasks · notes · projects · meeting · write</p>
            </div>
          </div>

          <Segmented
            options={[
              { id: 'tasks', label: 'Tasks' },
              { id: 'notes', label: 'Notes' },
              { id: 'projects', label: 'Projects' },
              { id: 'meeting', label: 'Meeting' },
              { id: 'write', label: 'Write' },
            ]}
            value={tab}
            onChange={(id) => setTab(id as Tab)}
          />
        </div>
      </header>

      <div className="orbit-body scroll-y">
        {tab === 'tasks' && <Tasks />}
        {tab === 'notes' && <Notes />}
        {tab === 'projects' && <Projects />}
        {tab === 'meeting' && <Meeting />}
        {tab === 'write' && <Write />}
      </div>
    </div>
  )
}
