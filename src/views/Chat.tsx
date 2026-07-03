import { useEffect, useRef, useState } from 'react'
import {
  Paperclip, PanelLeft, Search, Plus, ChevronLeft, X, FolderPlus, FolderOpen,
  Trash2, FileText, Terminal, FilePen, ShieldAlert, Eye, FolderSearch, Library, Orbit as OrbitIcon, Pencil,
} from 'lucide-react'
import Starfield from '../components/Starfield'
import Markdown, { CopyButton, plainTextFrom } from '../components/Markdown'
import Lightbox from '../components/Lightbox'
import FilePreview from './FilePreview'
import { goHome, navigateTo } from '../lib/router'
import { useAtlas } from '../store/atlas'
import { useChat, type Attachment, type Msg } from '../store/chat'
import { useSettings } from '../store/settings'
import { CHAT_TEMPERATURE } from '../lib/luna-prompt'
import { ConfirmModal, IconButton, openContextMenu, toast } from '../ui'
import './chat.css'

const fmtTime = (ts: number) => {
  const d = new Date(ts)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** icon + short label for an activity-log action */
function actionGlyph(action: string) {
  switch (action) {
    case 'read':
    case 'attach': return <FileText size={13} />
    case 'list': return <FolderSearch size={13} />
    case 'create':
    case 'overwrite':
    case 'write':
    case 'mkdir': return <FilePen size={13} />
    case 'delete': return <Trash2 size={13} />
    case 'run_code': return <Terminal size={13} />
    case 'grant': return <FolderPlus size={13} />
    default: return <FileText size={13} />
  }
}

function permGlyph(action: string) {
  if (action === 'run_code') return <Terminal size={16} />
  if (action === 'delete') return <Trash2 size={16} />
  return <FilePen size={16} />
}

const baseName = (p: string) => p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p

const CARD_VERB: Record<string, string> = {
  task: 'task', done: 'marked done', note: 'note', project: 'project',
  saved: 'saved', exists: 'already saved', search: 'search', article: 'opened',
  created: 'created', updated: 'updated',
}

/** Inline preview of an action Luna took — click to jump into the module, or preview the file. */
function ModCard({ card, onOpenFile }: { card: LunaChatCard; onOpenFile?: (path: string) => void }) {
  if (card.module === 'file') {
    const preview = () => card.path && onOpenFile?.(card.path)
    const reveal = () => card.path && window.api?.files?.reveal(card.path)
    return (
      <div className="mod-card mod-card--file">
        <button className="mod-open" onClick={preview} title="Preview file">
          <span className="mod-ico"><FileText size={15} /></span>
          <span className="mod-body">
            <span className="mod-title">{card.title}</span>
            {card.subtitle && <span className="mod-sub">{card.subtitle}</span>}
          </span>
        </button>
        <span className="mod-tag">Luna · {CARD_VERB[card.action] ?? card.action}</span>
        <button className="mod-reveal" onClick={reveal} title="Reveal in folder"><FolderOpen size={15} /></button>
      </div>
    )
  }

  const isAtlas = card.module === 'atlas'
  const open = () => {
    if (isAtlas) {
      useAtlas.getState().openReader(card.id ?? null) // deep-link to the exact item, or the library
      navigateTo('atlas')
    } else {
      navigateTo('module', 'Orbit')
    }
  }
  return (
    <button className="mod-card" onClick={open} title={isAtlas ? 'Open in Atlas' : 'Open in Orbit'}>
      <span className="mod-ico">{isAtlas ? <Library size={15} /> : <OrbitIcon size={15} />}</span>
      <span className="mod-body">
        <span className="mod-title">{card.title}</span>
        {card.subtitle && <span className="mod-sub">{card.subtitle}</span>}
      </span>
      <span className="mod-tag">
        {isAtlas ? 'Atlas' : 'Orbit'} · {CARD_VERB[card.action] ?? card.action}
        {card.itemType ? ` · ${card.itemType}` : ''}
      </span>
    </button>
  )
}

/** One of Luna's turns. Holds a ref to the rendered answer so copy yields clean, unformatted
 *  text (what you'd get by selecting it) rather than the raw markdown source. */
function LunaTurn({ m, onOpenFile }: { m: Msg; onOpenFile: (path: string) => void }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const cleanText = () => (bodyRef.current ? plainTextFrom(bodyRef.current) : m.content)
  const copyMessage = () => void navigator.clipboard.writeText(cleanText()).then(() => toast('Copied'))
  return (
    <div className="turn turn--luna">
      <span className="av" />
      <div
        className="voice"
        onContextMenu={(e) => openContextMenu(e, [{ label: 'Copy message', onSelect: copyMessage }])}
      >
        {m.content && (
          <div ref={bodyRef}>
            <Markdown content={m.content} saveLinks />
          </div>
        )}
        {!!m.cards?.length && (
          <div className="mod-cards">
            {m.cards.map((c, i) => (
              <ModCard key={i} card={c} onOpenFile={onOpenFile} />
            ))}
          </div>
        )}
        {m.content && (
          <div className="msg-tools">
            <CopyButton getText={cleanText} label="Copy message" />
          </div>
        )}
      </div>
    </div>
  )
}

export default function Chat() {
  const threads = useChat((s) => s.threads)
  const activeId = useChat((s) => s.activeId)
  const streamingByThread = useChat((s) => s.streamingByThread)
  const statusByThread = useChat((s) => s.statusByThread)
  const errorByThread = useChat((s) => s.errorByThread)
  const unreadIds = useChat((s) => s.unreadIds)
  const send = useChat((s) => s.send)
  const retractLast = useChat((s) => s.retractLast)
  const newThread = useChat((s) => s.newThread)
  const selectThread = useChat((s) => s.selectThread)
  const deleteThread = useChat((s) => s.deleteThread)

  const active = threads.find((t) => t.id === activeId)
  const messages = active?.messages ?? []
  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)

  const streaming = !!streamingByThread[activeId]
  const status = statusByThread[activeId] ?? null
  const error = errorByThread[activeId] ?? null
  const ambient = useSettings((s) => s.ambient)

  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<'chats' | 'files'>('chats')
  const [attachments, setAttachments] = useState<LunaAttachment[]>([])
  const [pending, setPending] = useState<LunaPermissionRequest[]>([])
  const [activity, setActivity] = useState<LunaActivity[]>([])
  const [grants, setGrants] = useState<LunaGrant[]>([])
  const [workspace, setWorkspace] = useState('')
  const [dragging, setDragging] = useState(false)
  const [viewer, setViewer] = useState<{ src: string; alt?: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLInputElement>(null)
  const stickToBottom = useRef(true)
  const dragDepth = useRef(0)

  const q = query.trim().toLowerCase()
  const visibleThreads = q
    ? sortedThreads.filter(
        (t) => t.title.toLowerCase().includes(q) || t.messages.some((m) => m.content.toLowerCase().includes(q)),
      )
    : sortedThreads

  // follow the stream only while already near the bottom
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    stickToBottom.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [activeId])

  // Ctrl/Cmd+N new · Ctrl/Cmd+K open drawer + focus search (while Luna is visible)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || document.getElementById('luna')?.hidden) return
      const k = e.key.toLowerCase()
      if (k === 'n') {
        e.preventDefault()
        newThread()
      } else if (k === 'k') {
        e.preventDefault()
        setDrawerTab('chats')
        setDrawerOpen(true)
        setTimeout(() => searchRef.current?.focus(), 60)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newThread])

  // file capabilities: workspace + grants + live activity + permission requests
  useEffect(() => {
    const f = window.api?.files
    if (!f) return
    f.workspace().then((w) => { setWorkspace(w.workspace); setGrants(w.grants) }).catch(() => {})
    f.activity(60).then(setActivity).catch(() => {})
    const offAct = f.onActivity((e) => setActivity((prev) => [e, ...prev].slice(0, 200)))
    const offGrants = f.onGrantsChanged(() => {
      f.grants().then(setGrants).catch(() => {})
      f.workspace().then((w) => setWorkspace(w.workspace)).catch(() => {})
    })
    const offPerm = f.onPermissionRequest((req) => setPending((prev) => [...prev, req]))
    return () => { offAct?.(); offGrants?.(); offPerm?.() }
  }, [])

  const submit = () => {
    const t = input.trim()
    const usable = attachments.filter((a) => a.text || a.preview)
    if ((!t && !usable.length) || streaming) return
    const atts: Attachment[] = usable.map((a) => ({ name: a.name, kind: a.kind, text: a.text, preview: a.preview }))
    setInput('')
    setAttachments([])
    stickToBottom.current = true
    send(t, { temperature: CHAT_TEMPERATURE }, atts)
  }

  // keep an attachment if it has model text OR a viewable image preview; toast the rest
  const addAttachments = (res: LunaAttachment[] | undefined) => {
    const good = (res ?? []).filter((a) => a.text || a.preview)
    const bad = (res ?? []).filter((a) => !a.text && !a.preview)
    if (good.length) setAttachments((prev) => [...prev, ...good])
    if (bad.length) toast(`Couldn't read ${bad.length} file${bad.length > 1 ? 's' : ''}`)
  }

  // paste an image straight from the clipboard into the composer
  const onPaste = async (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData?.items || []).filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    if (!imgs.length) return
    e.preventDefault()
    const out: LunaAttachment[] = []
    for (const it of imgs) {
      const file = it.getAsFile()
      if (!file) continue
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const name = file.name && !/^image\.\w+$/i.test(file.name) ? file.name : `pasted-${Date.now()}.${file.type.split('/')[1] || 'png'}`
        const res = await window.api?.files?.attachData?.(name, bytes, file.type)
        if (res) out.push(res)
      } catch { /* skip an unreadable clipboard item */ }
    }
    addAttachments(out)
  }

  // Stop-and-edit / edit-last: pull the latest user message back into the composer, cancelling
  // any in-flight reply and removing that turn from the thread.
  const retractToComposer = () => {
    const text = retractLast(activeId)
    if (text == null) return
    setInput(text)
    stickToBottom.current = true
    requestAnimationFrame(() => {
      const el = composerRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }

  const copyText = (text: string, msg = 'Copied') => {
    void navigator.clipboard.writeText(text).then(() => toast(msg))
  }

  const respond = (id: string, approved: boolean) => {
    window.api?.files?.respondPermission(id, approved)
    setPending((prev) => prev.filter((p) => p.id !== id))
  }

  const doAttach = async () => {
    addAttachments(await window.api?.files?.attach().catch(() => []))
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const files = Array.from(e.dataTransfer.files || [])
    const paths = files.map((f) => window.api?.files?.getPathForFile(f)).filter((p): p is string => !!p)
    if (!paths.length) return
    addAttachments(await window.api?.files?.attachPaths(paths).catch(() => []))
  }

  const grantFolder = async () => {
    const r = await window.api?.files?.grantFolder().catch(() => null)
    if (r?.ok) toast('Folder granted')
    else if (r && r.error) toast(r.error)
  }
  const revoke = async (id: string) => {
    await window.api?.files?.revoke(id)
    setGrants((prev) => prev.filter((g) => g.id !== id))
  }

  const last = messages[messages.length - 1]
  const showThinking = streaming && last?.role === 'assistant' && !last.content
  const canSend = (input.trim() || attachments.some((a) => a.text)) && !streaming
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user')

  return (
    <div
      className={'view view--luna' + (dragging ? ' dropping' : '')}
      id="luna"
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragging(true) }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }}
      onDrop={onDrop}
    >
      <div className="luna-bg">
        <div className="glow" />
        <div className="glow2" />
        {ambient !== 'off' && (
          <Starfield count={ambient === 'subtle' ? 60 : 120} maxOpacity={ambient === 'subtle' ? 0.24 : 0.4} />
        )}
      </div>

      {/* edge hover-zone that reveals the drawer */}
      <div className="edge-zone" onMouseEnter={() => setDrawerOpen(true)}>
        <span className="edge-hint" />
      </div>

      {/* floating minimal controls — chrome that melts away */}
      <div className="stage-top">
        <button className="ghost-btn" onClick={goHome} title="System (Esc)" aria-label="Back to System">
          <ChevronLeft size={19} />
        </button>
        <button className="ghost-btn" onClick={() => { setDrawerTab('chats'); setDrawerOpen(true) }} title="History (Ctrl+K)" aria-label="History">
          <PanelLeft size={18} />
        </button>
        <span className="stage-presence"><span className="presence" />{streaming ? status ?? 'thinking…' : 'Luna'}</span>
      </div>

      <main className="stage">
        <div
          className="scroll"
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
        >
          <div className="thread-col">
            {messages.length === 0 && (
              <div className="chat-empty">
                <div className="chat-empty-orb" />
                <h2>Ask Luna anything</h2>
                <p>Read files, run code, or just talk. Everything stays on this device.</p>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === 'assistant' && m.content === '' && !m.cards?.length ? null : m.role === 'user' ? (
                <div key={m.id} className="turn turn--user">
                  <div className="user-stack">
                    {!!m.attachments?.length && (
                      <div className="att-row att-row--sent">
                        {m.attachments.map((a, j) =>
                          a.preview ? (
                            <button key={j} className="att-thumb att-thumb--sent" title={a.name} onClick={() => setViewer({ src: a.preview!, alt: a.name })}>
                              <img src={a.preview} alt={a.name} />
                            </button>
                          ) : (
                            <span key={j} className="att-chip att-chip--sent"><FileText size={12} />{a.name}</span>
                          ),
                        )}
                      </div>
                    )}
                    {m.content && (
                      <div
                        className="bubble"
                        onContextMenu={(e) =>
                          openContextMenu(e, [
                            { label: 'Copy message', onSelect: () => copyText(m.content) },
                            ...(i === lastUserIdx && !streaming ? [{ label: 'Edit message', onSelect: retractToComposer }] : []),
                          ])
                        }
                      >
                        {m.content}
                      </div>
                    )}
                    {i === lastUserIdx && !streaming && m.content && (
                      <div className="msg-tools msg-tools--user">
                        <button className="copybtn" onClick={retractToComposer} title="Edit message" aria-label="Edit message">
                          <Pencil /> Edit
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <LunaTurn key={m.id} m={m} onOpenFile={setPreview} />
              ),
            )}

            {showThinking && (
              <div className="thinking">
                <span className="av" />
                {status ? (
                  <span className="status-line">{status}</span>
                ) : (
                  <div className="dots"><span /><span /><span /></div>
                )}
              </div>
            )}

            {error && <div className="chat-error">{error}</div>}
          </div>
        </div>

        <div className="composer-wrap">
          {/* pending permission cards — inline, matching the chrome-less look */}
          {pending.map((p) => (
            <div key={p.id} className={'perm-card' + (p.action === 'delete' ? ' perm-card--danger' : '')}>
              <div className="perm-head">
                <span className="perm-ico">{permGlyph(p.action)}</span>
                <span className="perm-label">{p.label}</span>
                <span className="perm-tier"><ShieldAlert size={12} />{p.tier === 'confirm' ? 'Needs confirmation' : 'Approve once'}</span>
              </div>
              {p.detail && <pre className="perm-detail">{p.detail}</pre>}
              <div className="perm-actions">
                <button className="perm-btn" onClick={() => respond(p.id, false)}>Decline</button>
                <button className="perm-btn perm-btn--go" onClick={() => respond(p.id, true)}>
                  {p.action === 'run_code' ? 'Run' : p.action === 'delete' ? 'Move to bin' : 'Allow'}
                </button>
              </div>
            </div>
          ))}

          {!!attachments.length && (
            <div className="att-row">
              {attachments.map((a, i) => {
                const remove = () => setAttachments((prev) => prev.filter((_, j) => j !== i))
                return a.preview ? (
                  <span key={i} className="att-thumb">
                    <img src={a.preview} alt={a.name} title={a.name} onClick={() => setViewer({ src: a.preview!, alt: a.name })} />
                    <button className="att-thumb-x" onClick={remove} aria-label="Remove"><X size={11} /></button>
                  </span>
                ) : (
                  <span key={i} className="att-chip">
                    <FileText size={12} />
                    <span className="att-name">{a.name}</span>
                    <button className="att-x" onClick={remove} aria-label="Remove"><X size={11} /></button>
                  </span>
                )
              })}
            </div>
          )}

          <div className="dock dock--chat">
            <button className="dock-attach" onClick={doAttach} title="Attach files" aria-label="Attach files">
              <Paperclip size={17} />
            </button>
            <input
              ref={composerRef}
              placeholder="Message Luna…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            {streaming ? (
              <button className="send send--stop" aria-label="Stop and edit" title="Stop and pull your message back to edit" onClick={retractToComposer}>
                <svg viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" /></svg>
              </button>
            ) : (
              <button className="send" aria-label="Send" onClick={submit} disabled={!canSend}>
                <svg viewBox="0 0 16 16"><path d="M2 8h11M9 4l4 4-4 4" /></svg>
              </button>
            )}
          </div>
        </div>
      </main>

      {dragging && (
        <div className="drop-veil">
          <div className="drop-card"><Paperclip size={22} /><span>Drop files to attach</span></div>
        </div>
      )}

      {/* the edge drawer: history + files/activity */}
      <aside className={'drawer' + (drawerOpen ? ' open' : '')} onMouseLeave={() => setDrawerOpen(false)}>
        <div className="drawer-head">
          <div className="dtabs">
            <button className={drawerTab === 'chats' ? 'on' : ''} onClick={() => setDrawerTab('chats')}>Chats</button>
            <button className={drawerTab === 'files' ? 'on' : ''} onClick={() => setDrawerTab('files')}>Files</button>
          </div>
          <IconButton label="Close" onClick={() => setDrawerOpen(false)}><X size={15} /></IconButton>
        </div>

        {drawerTab === 'chats' ? (
          <>
            <div className="drawer-row">
              <div className="drawer-search">
                <Search size={14} />
                <input
                  ref={searchRef}
                  placeholder="Search conversations…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') } }}
                />
              </div>
              <button className="mini-btn" onClick={newThread} title="New conversation (Ctrl+N)"><Plus size={15} /></button>
            </div>
            <div className="drawer-scroll">
              <div className="grp-label">{q ? 'Results' : 'Recent'}</div>
              {q && visibleThreads.length === 0 && <div className="drawer-empty">No matches</div>}
              {visibleThreads.map((t) => (
                <div
                  key={t.id}
                  className={'thread' + (t.id === activeId ? ' active' : '')}
                  onContextMenu={(e) =>
                    openContextMenu(e, [
                      { label: 'Open', onSelect: () => selectThread(t.id), disabled: t.id === activeId },
                      { label: 'New conversation', onSelect: newThread },
                      {
                        label: 'Copy conversation',
                        disabled: t.messages.length === 0,
                        onSelect: () =>
                          copyText(
                            t.messages.map((m) => `${m.role === 'user' ? 'You' : 'Luna'}: ${m.content}`).join('\n\n'),
                            'Conversation copied',
                          ),
                      },
                      'sep',
                      { label: 'Delete conversation', danger: true, onSelect: () => setConfirmDelete(t.id) },
                    ])
                  }
                >
                  <button className="thread-main" onClick={() => { selectThread(t.id); setDrawerOpen(false) }}>
                    <span className="tt">
                      {streamingByThread[t.id] && <span className="thread-dot thread-dot--live" title="Responding…" />}
                      {!streamingByThread[t.id] && unreadIds[t.id] && <span className="thread-dot thread-dot--unread" title="New response" />}
                      {t.title}
                    </span>
                    <span className="tm">{fmtTime(t.updatedAt)}</span>
                  </button>
                  <IconButton label="Delete conversation" className="row-del" onClick={() => setConfirmDelete(t.id)}>
                    <X size={13} />
                  </IconButton>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="drawer-scroll files">
            <div className="grp-label">Workspace</div>
            <div className="ws-row">
              <FolderOpen size={14} />
              <span className="ws-path" title={workspace}>{workspace ? baseName(workspace) : 'Luna'}</span>
              <IconButton label="Open workspace" onClick={() => window.api?.files?.openWorkspace()}><Eye size={14} /></IconButton>
            </div>

            <div className="grp-label with-action">
              Granted folders
              <button className="mini-btn" onClick={grantFolder} title="Grant a folder"><FolderPlus size={14} /></button>
            </div>
            {grants.length === 0 && <div className="drawer-empty">None yet — Luna works in its workspace.</div>}
            {grants.map((g) => (
              <div key={g.id} className="grant-row">
                <FolderOpen size={13} />
                <span className="ws-path" title={g.path}>{baseName(g.path)}</span>
                <IconButton label="Reveal" onClick={() => window.api?.files?.reveal(g.path)}><Eye size={13} /></IconButton>
                <IconButton label="Revoke" className="row-del" onClick={() => revoke(g.id)}><Trash2 size={13} /></IconButton>
              </div>
            ))}

            <div className="grp-label">Activity</div>
            {activity.length === 0 && <div className="drawer-empty">Nothing yet.</div>}
            {activity.map((a) => (
              <button
                key={a.id}
                className={'act-row' + (a.ok ? '' : ' bad')}
                onClick={() => a.target && window.api?.files?.reveal(a.target)}
                title={a.target}
              >
                <span className="act-ico">{actionGlyph(a.action)}</span>
                <span className="act-body">
                  <span className="act-name">{a.action === 'run_code' ? 'ran code' : baseName(a.target)}</span>
                  <span className="act-meta">{a.detail || a.action}</span>
                </span>
                <span className="act-time">{fmtTime(a.at)}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <ConfirmModal
        open={!!confirmDelete}
        title="Delete conversation?"
        message="This conversation and its messages will be permanently deleted."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) deleteThread(confirmDelete)
          setConfirmDelete(null)
        }}
      />

      {viewer && <Lightbox src={viewer.src} alt={viewer.alt} onClose={() => setViewer(null)} />}
      {preview && <FilePreview path={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
