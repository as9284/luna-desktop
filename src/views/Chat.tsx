import { useEffect, useRef, useState } from 'react'
import Starfield from '../components/Starfield'
import Markdown, { CopyButton } from '../components/Markdown'
import { goHome } from '../lib/router'
import { useChat } from '../store/chat'
import { useSettings } from '../store/settings'
import { systemPrompt, tempForMode } from '../lib/luna-prompt'
import { ConfirmModal, IconButton, openContextMenu, toast } from '../ui'
import './chat.css'

const fmtTime = (ts: number) => {
  const d = new Date(ts)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const XIcon = () => (
  <svg viewBox="0 0 14 14">
    <path d="M4 4l6 6M10 4l-6 6" />
  </svg>
)

export default function Chat() {
  const threads = useChat((s) => s.threads)
  const activeId = useChat((s) => s.activeId)
  const streamingByThread = useChat((s) => s.streamingByThread)
  const statusByThread = useChat((s) => s.statusByThread)
  const errorByThread = useChat((s) => s.errorByThread)
  const unreadIds = useChat((s) => s.unreadIds)
  const send = useChat((s) => s.send)
  const stop = useChat((s) => s.stop)
  const newThread = useChat((s) => s.newThread)
  const selectThread = useChat((s) => s.selectThread)
  const deleteThread = useChat((s) => s.deleteThread)
  const mode = useSettings((s) => s.mode)

  const active = threads.find((t) => t.id === activeId)
  const messages = active?.messages ?? []
  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)

  const streaming = !!streamingByThread[activeId]
  const status = statusByThread[activeId] ?? null
  const error = errorByThread[activeId] ?? null

  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const stickToBottom = useRef(true)

  const q = query.trim().toLowerCase()
  const visibleThreads = q
    ? sortedThreads.filter(
        (t) => t.title.toLowerCase().includes(q) || t.messages.some((m) => m.content.toLowerCase().includes(q)),
      )
    : sortedThreads

  // follow the stream only while the user is already near the bottom
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  // jump to the bottom when switching threads
  useEffect(() => {
    stickToBottom.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [activeId])

  // Ctrl/Cmd+N — new conversation, Ctrl/Cmd+K — search (while the chat view is visible)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || document.getElementById('luna')?.hidden) return
      const k = e.key.toLowerCase()
      if (k === 'n') {
        e.preventDefault()
        newThread()
      } else if (k === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newThread])

  const submit = () => {
    const t = input.trim()
    if (!t || streaming) return
    setInput('')
    stickToBottom.current = true
    send(t, { temperature: tempForMode(mode), system: systemPrompt() })
  }

  const copyText = (text: string, msg = 'Copied') => {
    void navigator.clipboard.writeText(text).then(() => toast(msg))
  }

  const last = messages[messages.length - 1]
  const showThinking = streaming && last?.role === 'assistant' && !last.content

  return (
    <div className="view view--luna" id="luna">
      <div className="luna-bg">
        <div className="glow" />
        <div className="glow2" />
        <Starfield count={120} maxOpacity={0.4} />
      </div>

      <div className="chat">
        <aside className="rail">
          <div className="rail-head">
            <h3>Conversations</h3>
            <button className="newbtn" aria-label="New conversation (Ctrl+N)" title="New conversation (Ctrl+N)" onClick={newThread}>
              <svg viewBox="0 0 14 14">
                <path d="M7 3v8M3 7h8" />
              </svg>
            </button>
          </div>
          <div className="rail-search">
            <input
              ref={searchRef}
              placeholder="Search conversations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.stopPropagation()
                  setQuery('')
                }
              }}
            />
          </div>
          <div className="groups">
            <div className="grp-label">{q ? 'Results' : 'Recent'}</div>
            {q && visibleThreads.length === 0 && <div className="rail-empty">No matches</div>}
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
                <button className="thread-main" onClick={() => selectThread(t.id)}>
                  <span className="tt">
                    {streamingByThread[t.id] && <span className="thread-dot thread-dot--live" title="Responding…" />}
                    {!streamingByThread[t.id] && unreadIds[t.id] && (
                      <span className="thread-dot thread-dot--unread" title="New response" />
                    )}
                    {t.title}
                  </span>
                  <span className="tm">{fmtTime(t.updatedAt)}</span>
                </button>
                <IconButton label="Delete conversation" className="row-del" onClick={() => setConfirmDelete(t.id)}>
                  <XIcon />
                </IconButton>
              </div>
            ))}
          </div>
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

        <section className="convo">
          <div className="convo-head">
            <button className="backbtn" onClick={goHome}>
              <svg viewBox="0 0 14 14">
                <path d="M9 3l-4 4 4 4" />
              </svg>
              System
            </button>
            <span className="convo-title">Luna</span>
            <span className="convo-sub">
              <span className="presence" />
              {streaming ? status ?? 'thinking…' : 'online'}
            </span>
          </div>

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
                  <p>Your conversation stays on this device.</p>
                </div>
              )}

              {messages.map((m) =>
                m.role === 'assistant' && m.content === '' ? null : m.role === 'user' ? (
                  <div key={m.id} className="turn turn--user">
                    <div
                      className="bubble"
                      onContextMenu={(e) =>
                        openContextMenu(e, [{ label: 'Copy message', onSelect: () => copyText(m.content) }])
                      }
                    >
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="turn turn--luna">
                    <span className="av" />
                    <div
                      className="voice"
                      onContextMenu={(e) =>
                        openContextMenu(e, [{ label: 'Copy message', onSelect: () => copyText(m.content) }])
                      }
                    >
                      <Markdown content={m.content} saveLinks />
                      <div className="msg-tools">
                        <CopyButton text={m.content} label="Copy message" />
                      </div>
                    </div>
                  </div>
                ),
              )}

              {showThinking && (
                <div className="thinking">
                  <span className="av" />
                  {status ? (
                    <span className="status-line">{status}</span>
                  ) : (
                    <div className="dots">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </div>
              )}

              {error && <div className="chat-error">{error}</div>}
            </div>
          </div>

          <div className="composer-wrap">
            <div className="dock dock--chat">
              <span className="lmark" />
              <input
                placeholder="Message Luna…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
              />
              {streaming ? (
                <button className="send send--stop" aria-label="Stop generating" title="Stop generating" onClick={() => stop(activeId)}>
                  <svg viewBox="0 0 16 16">
                    <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
                  </svg>
                </button>
              ) : (
                <button className="send" aria-label="Send" onClick={submit}>
                  <svg viewBox="0 0 16 16">
                    <path d="M2 8h11M9 4l4 4-4 4" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
