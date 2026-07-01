import { useEffect, useRef, useState } from 'react'
import Starfield from '../components/Starfield'
import { goHome } from '../lib/router'
import { useChat } from '../store/chat'
import { useSettings } from '../store/settings'
import { systemPrompt, tempForMode } from '../lib/luna-prompt'
import { ConfirmModal, IconButton } from '../ui'
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
  const streaming = useChat((s) => s.streaming)
  const status = useChat((s) => s.status)
  const error = useChat((s) => s.error)
  const send = useChat((s) => s.send)
  const newThread = useChat((s) => s.newThread)
  const selectThread = useChat((s) => s.selectThread)
  const deleteThread = useChat((s) => s.deleteThread)
  const mode = useSettings((s) => s.mode)

  const active = threads.find((t) => t.id === activeId)
  const messages = active?.messages ?? []
  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)

  const [input, setInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const submit = () => {
    const t = input.trim()
    if (!t || streaming) return
    setInput('')
    send(t, { temperature: tempForMode(mode), system: systemPrompt() })
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
            <button className="newbtn" aria-label="New conversation" onClick={newThread}>
              <svg viewBox="0 0 14 14">
                <path d="M7 3v8M3 7h8" />
              </svg>
            </button>
          </div>
          <div className="groups">
            <div className="grp-label">Recent</div>
            {sortedThreads.map((t) => (
              <div key={t.id} className={'thread' + (t.id === activeId ? ' active' : '')}>
                <button className="thread-main" onClick={() => selectThread(t.id)}>
                  <span className="tt">{t.title}</span>
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

          <div className="scroll" ref={scrollRef}>
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
                    <div className="bubble">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id} className="turn turn--luna">
                    <span className="av" />
                    <div className="voice">
                      <p>{m.content}</p>
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
            <div className="composer-hint">/ for commands</div>
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
              <button className="send" aria-label="Send" onClick={submit}>
                <svg viewBox="0 0 16 16">
                  <path d="M2 8h11M9 4l4 4-4 4" />
                </svg>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
