import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { goHome } from '../lib/router'
import { useAtlas } from '../store/atlas'
import { useOrbit } from '../store/orbit'
import Markdown from '../components/Markdown'
import Lightbox from '../components/Lightbox'
import DocViewer from './doc/DocViewer'
import { hasVaultFile } from './doc/helpers'
import {
  Badge,
  Button,
  ConfirmModal,
  type ContextItem,
  IconButton,
  Input,
  Menu,
  Modal,
  openContextMenu,
  Segmented,
  Select,
  Textarea,
  toast,
} from '../ui'
import './atlas.css'

type Tab = 'library' | 'highlights'

const fmt = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const readTime = (words: number) => `${Math.max(1, Math.round(words / 220))} min`

const XIcon = () => (
  <svg viewBox="0 0 14 14">
    <path d="M4 4l6 6M10 4l-6 6" />
  </svg>
)
const PinIcon = () => (
  <svg viewBox="0 0 14 14">
    <path d="M7 1.5v7M7 8.5l-3 4M7 8.5l3 4M4 4.5h6" />
  </svg>
)

const NEXT_STATUS: Record<AtlasStatus, AtlasStatus> = { unread: 'reading', reading: 'done', done: 'unread' }
const STATUS_LABEL: Record<AtlasStatus, string> = { unread: 'Mark unread', reading: 'Mark reading', done: 'Mark done' }

const TYPE_LABEL: Record<AtlasMediaType, string> = {
  article: '',
  social: 'Post',
  video: 'Video',
  image: 'Image',
  pdf: 'PDF',
  stub: 'Link',
  file: 'Doc',
}
/** The small type chip shown on cards + in the reader — the platform, or a generic label. */
const typeChip = (item: AtlasItem): string | null =>
  item.mediaType === 'article'
    ? null
    : item.mediaType === 'file'
      ? (item.meta?.fileType || 'file').toUpperCase()
      : item.meta?.siteName || TYPE_LABEL[item.mediaType] || null

/** Format a possibly-ISO / platform date string, falling back to the raw value. */
const fmtWhen = (s?: string): string | null => {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : fmt(d.getTime())
}

function Empty({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="panel-empty">
      <div className="empty-orb empty-orb--atlas" />
      <b>{label}</b>
      <span>{hint}</span>
    </div>
  )
}

/* ================================================================ capture */

const isUrlLine = (l: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(l)

interface SaveLine {
  input: string
  label: string
  state: 'waiting' | 'extracting' | 'summarizing' | 'saved' | 'exists' | 'failed'
  error?: string
}

const LINE_LABEL: Record<SaveLine['state'], string> = {
  waiting: 'waiting',
  extracting: 'reading…',
  summarizing: 'summarizing…',
  saved: 'saved',
  exists: 'already saved',
  failed: 'failed',
}

function CaptureModal({ open, onClose, hasKey }: { open: boolean; onClose: () => void; hasKey: boolean }) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [lines, setLines] = useState<SaveLine[]>([])
  const [running, setRunning] = useState(false)

  const rows = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const urlMode = rows.length > 0 && rows.every(isUrlLine)

  const close = () => {
    if (running) return
    setText('')
    setTitle('')
    setLines([])
    onClose()
  }

  const run = async () => {
    const api = window.api?.atlas
    if (!api || rows.length === 0 || running) return
    setRunning(true)

    const setLine = (i: number, patch: Partial<SaveLine>) =>
      setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

    if (urlMode) {
      const init: SaveLine[] = rows.map((r) => ({ input: r, label: r.replace(/^https?:\/\//, ''), state: 'waiting' }))
      setLines(init)
      for (let i = 0; i < rows.length; i++) {
        setLine(i, { state: 'extracting' })
        try {
          const res = await api.saveUrl(rows[i])
          if (!res.ok || !res.item) {
            setLine(i, { state: 'failed', error: res.error })
            continue
          }
          if (res.existed) {
            setLine(i, { state: 'exists', label: res.item.title })
            continue
          }
          setLine(i, { label: res.item.title })
          if (hasKey) {
            setLine(i, { state: 'summarizing' })
            const d = await api.digest(res.item.id)
            setLine(i, { state: 'saved', error: d.warning ?? undefined })
          } else {
            setLine(i, { state: 'saved' })
          }
        } catch (e) {
          setLine(i, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
        }
      }
    } else {
      setLines([{ input: text, label: title.trim() || 'Snippet', state: 'extracting' }])
      try {
        const res = await api.saveText(title, text)
        if (!res.ok || !res.item) {
          setLine(0, { state: 'failed', error: res.error })
        } else if (hasKey) {
          setLine(0, { state: 'summarizing', label: res.item.title })
          const d = await api.digest(res.item.id)
          setLine(0, { state: 'saved', error: d.warning ?? undefined })
        } else {
          setLine(0, { state: 'saved', label: res.item.title })
        }
      } catch (e) {
        setLine(0, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
      }
    }
    setRunning(false)
    setText('')
    setTitle('')
  }

  const addFiles = async () => {
    const api = window.api?.atlas
    if (!api?.saveFile || running) return
    setRunning(true)
    const res = await api.saveFile().catch(() => [])
    if (res.length) {
      setLines(
        res.map((r) =>
          r.ok && r.item
            ? { input: '', label: r.item.title, state: 'saved' as const }
            : { input: '', label: r.name || 'File', state: 'failed' as const, error: r.error },
        ),
      )
    }
    setRunning(false)
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Save to Atlas"
      wide
      actions={
        <>
          <Button variant="secondary" small onClick={close} disabled={running}>
            {lines.length && !running ? 'Done' : 'Cancel'}
          </Button>
          <Button variant="primary" small onClick={run} disabled={rows.length === 0 || running}>
            {running ? 'Saving…' : urlMode && rows.length > 1 ? `Save ${rows.length} links` : 'Save'}
          </Button>
        </>
      }
    >
      <div className="capture">
        <div className="capture-files">
          <Button variant="secondary" small disabled={running} onClick={addFiles}>Add documents from disk…</Button>
          <span className="capture-hint">PDF · Word · Excel · text · code · images</span>
        </div>
        <Textarea
          placeholder={'Paste links (one per line) — or any text to keep as a snippet…'}
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={running}
        />
        {!urlMode && rows.length > 0 && (
          <Input
            placeholder="Snippet title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={running}
          />
        )}
        {lines.length > 0 && (
          <div className="capture-lines">
            {lines.map((l, i) => (
              <div key={i} className={'capture-line' + (l.state === 'failed' ? ' failed' : '')}>
                <span className="capture-name">{l.label}</span>
                <span className="capture-state">{LINE_LABEL[l.state]}</span>
                {l.error && <span className="capture-err">{l.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ================================================================ synthesize */

function synthesisPrompt(): string {
  return [
    'You are Luna. Write a research briefing that synthesizes the provided saved articles.',
    'Plain text only — NO markdown symbols (no #, no *, no backticks).',
    'Use UPPERCASE section labels on their own line: OVERVIEW, AGREEMENTS, TENSIONS, OPEN QUESTIONS.',
    "Under a section, put each point on its own line starting with '- ', naming which article(s) it comes from.",
    'Include only sections the articles actually support. Stay faithful to the texts — do not invent facts.',
  ].join(' ')
}

function SynthesizeModal({ items, onClose }: { items: AtlasItem[]; onClose: () => void }) {
  const addNote = useOrbit((s) => s.addNote)
  const updateNote = useOrbit((s) => s.updateNote)
  const [output, setOutput] = useState('')
  const [reqId, setReqId] = useState<string | null>(null)
  const started = useRef(false)
  const running = !!reqId

  useEffect(() => {
    if (started.current || items.length === 0) return
    started.current = true
    const api = window.api
    if (!api?.chat) return
    const id = crypto.randomUUID()
    setReqId(id)
    const corpus = items
      .map((it, i) => {
        const source = [it.title, it.domain].filter(Boolean).join(' — ')
        const text = it.summary
          ? [it.summary, ...it.keyPoints.map((k) => `- ${k}`)].join('\n')
          : (it.excerpt ?? '')
        return `ARTICLE ${i + 1}: ${source}\n${text}`
      })
      .join('\n\n')
    api
      .chat(
        {
          id,
          messages: [
            { role: 'system', content: synthesisPrompt() },
            { role: 'user', content: corpus },
          ],
          temperature: 0.4,
          tools: false,
        },
        (token) => setOutput((o) => o + token),
      )
      .catch((e) => toast(e instanceof Error ? e.message : 'Synthesis failed'))
      .finally(() => setReqId(null))
  }, [items])

  const save = () => {
    const id = addNote()
    updateNote(id, { title: `Synthesis: ${items.map((i) => i.title).join(' · ')}`.slice(0, 80), body: output })
    toast('Saved to Orbit notes')
  }

  return (
    <Modal
      open
      onClose={() => {
        if (reqId) window.api?.cancelChat?.(reqId)
        onClose()
      }}
      title={`Synthesize ${items.length} articles`}
      wide
      actions={
        running ? (
          <Button variant="secondary" small onClick={() => window.api?.cancelChat?.(reqId!)}>
            Stop
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              small
              onClick={() => navigator.clipboard.writeText(output).then(() => toast('Copied'))}
              disabled={!output}
            >
              Copy
            </Button>
            <Button variant="primary" small onClick={save} disabled={!output}>
              Save to Orbit
            </Button>
          </>
        )
      }
    >
      <div className={'synth-out' + (output ? '' : ' empty')}>{output || 'Reading the articles…'}</div>
    </Modal>
  )
}

/* ================================================================ library */

function ItemCard({
  item,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  onContext,
}: {
  item: AtlasItem
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onContext: (e: ReactMouseEvent) => void
}) {
  const meta = [
    item.domain ?? 'snippet',
    fmt(item.savedAt),
    item.wordCount ? readTime(item.wordCount) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={
        'atlas-card' + (selected ? ' selected' : '') + (item.status === 'done' ? ' read-done' : '')
      }
      role="button"
      tabIndex={0}
      onClick={selectMode ? onToggleSelect : onOpen}
      onContextMenu={selectMode ? undefined : onContext}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (selectMode ? onToggleSelect : onOpen)()
      }}
    >
      <div className="atlas-card-top">
        {item.queuedAt !== null && <span className="queued-dot" title="Up next" />}
        <b>{item.title}</b>
        {selectMode && <span className={'sel-box' + (selected ? ' on' : '')} />}
      </div>
      <i>{meta}</i>
      <p>{item.summary ?? item.excerpt ?? 'No preview'}</p>
      <div className="atlas-card-foot">
        <span className={'read-pill read-pill--' + item.status}>{item.status}</span>
        {typeChip(item) && <Badge variant="outline">{typeChip(item)}</Badge>}
        {item.shelf === 'research' && <Badge variant="outline">research</Badge>}
        {item.tags.slice(0, 3).map((t) => (
          <Badge key={t} variant="subtle">
            {t}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function Library({ hasKey }: { hasKey: boolean }) {
  const items = useAtlas((s) => s.items)
  const facets = useAtlas((s) => s.facets)
  const filters = useAtlas((s) => s.filters)
  const setFilters = useAtlas((s) => s.setFilters)
  const openReader = useAtlas((s) => s.openReader)

  const [capture, setCapture] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [synthItems, setSynthItems] = useState<AtlasItem[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [ctxDelete, setCtxDelete] = useState<AtlasItem | null>(null)

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const exitSelect = () => {
    setSelectMode(false)
    setSelected(new Set())
  }

  const exportSel = async (ids: string[]) => {
    const res = await window.api?.atlas.exportItems(ids)
    if (!res) return
    if (res.ok) toast(res.count === 1 ? 'Exported' : `Exported ${res.count} files`)
    else if (!res.canceled) toast(res.error ?? 'Export failed')
  }

  const deleteSel = async () => {
    for (const id of selected) await window.api?.atlas.remove(id)
    toast(`Deleted ${selected.size} ${selected.size === 1 ? 'item' : 'items'}`)
    exitSelect()
  }

  const itemMenu = (item: AtlasItem): ContextItem[] => [
    { label: 'Open', onSelect: () => openReader(item.id) },
    ...(item.url
      ? [
          {
            label: 'Copy link',
            onSelect: () => void navigator.clipboard.writeText(item.url!).then(() => toast('Link copied')),
          },
        ]
      : []),
    'sep',
    ...(Object.keys(STATUS_LABEL) as AtlasStatus[]).map((st) => ({
      label: STATUS_LABEL[st],
      disabled: item.status === st,
      onSelect: () => void window.api?.atlas.update(item.id, { status: st }),
    })),
    {
      label: item.queuedAt === null ? 'Add to Up next' : 'Remove from Up next',
      onSelect: () => {
        const queuedAt = item.queuedAt === null ? Date.now() : null
        void window.api?.atlas.update(item.id, { queuedAt })
        toast(queuedAt ? 'Added to Up next' : 'Removed from Up next')
      },
    },
    { label: 'Export Markdown', onSelect: () => void exportSel([item.id]) },
    'sep',
    { label: 'Delete', danger: true, onSelect: () => setCtxDelete(item) },
  ]

  const filtersActive = filters.status !== 'all' || filters.tag || filters.domain || filters.query.trim()
  const queued = items.filter((i) => i.queuedAt !== null).length

  return (
    <div className="panel atlas-panel">
      {!hasKey && (
        <div className="meeting-warn">
          Add an API key in Settings and Luna will summarize what you save. Saving, reading, and search work without
          one.
        </div>
      )}

      <div className="add-row">
        <Input
          placeholder="Search the library…"
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value })}
          style={{ flex: 1 }}
        />
        <Button variant="secondary" small onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
          {selectMode ? 'Cancel' : 'Select'}
        </Button>
        <Button variant="primary" small onClick={() => setCapture(true)}>
          Save
        </Button>
      </div>

      <div className="atlas-filters">
        <Segmented
          options={[
            { id: 'all', label: 'All' },
            { id: 'queued', label: 'Up next' },
            { id: 'unread', label: 'Unread' },
            { id: 'reading', label: 'Reading' },
            { id: 'done', label: 'Done' },
          ]}
          value={filters.status}
          onChange={(id) => setFilters({ status: id as typeof filters.status })}
        />
        {facets.tags.length > 0 && (
          <Select
            className="atlas-facet"
            value={filters.tag ?? ''}
            onChange={(v) => setFilters({ tag: v || null })}
            options={[{ value: '', label: 'All tags' }, ...facets.tags.map((t) => ({ value: t, label: t }))]}
          />
        )}
        {facets.domains.length > 0 && (
          <Select
            className="atlas-facet"
            value={filters.domain ?? ''}
            onChange={(v) => setFilters({ domain: v || null })}
            options={[{ value: '', label: 'All sources' }, ...facets.domains.map((d) => ({ value: d, label: d }))]}
          />
        )}
      </div>

      {items.length === 0 ? (
        filtersActive ? (
          <Empty label="No matches" hint="Nothing in the library fits those filters." />
        ) : (
          <Empty label="Nothing saved yet" hint="Save a link or a snippet — Atlas keeps the full text forever." />
        )
      ) : (
        <div className="atlas-grid">
          {items.map((it) => (
            <ItemCard
              key={it.id}
              item={it}
              selectMode={selectMode}
              selected={selected.has(it.id)}
              onToggleSelect={() => toggleSelect(it.id)}
              onOpen={() => openReader(it.id)}
              onContext={(e) => openContextMenu(e, itemMenu(it))}
            />
          ))}
        </div>
      )}

      <div className="panel-foot">
        <span className="count">
          {items.length} {items.length === 1 ? 'item' : 'items'}
          {queued > 0 ? ` · ${queued} up next` : ''}
        </span>
        {!selectMode && items.length > 0 && (
          <Button variant="ghost" small onClick={() => exportSel(items.map((i) => i.id))}>
            Export all
          </Button>
        )}
      </div>

      {selectMode && (
        <div className="sel-bar">
          <span className="count">{selected.size} selected</span>
          <div className="sel-bar-actions">
            <Button
              variant="secondary"
              small
              disabled={selected.size < 2 || selected.size > 5 || !hasKey}
              title={hasKey ? 'Compare 2–5 articles' : 'Needs an API key (Settings)'}
              onClick={() => setSynthItems(items.filter((i) => selected.has(i.id)))}
            >
              Synthesize
            </Button>
            <Button variant="secondary" small disabled={selected.size === 0} onClick={() => exportSel([...selected])}>
              Export
            </Button>
            <Button variant="danger" small disabled={selected.size === 0} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        </div>
      )}

      <CaptureModal open={capture} onClose={() => setCapture(false)} hasKey={hasKey} />
      {synthItems && <SynthesizeModal items={synthItems} onClose={() => setSynthItems(null)} />}
      <ConfirmModal
        open={confirmDelete}
        title={`Delete ${selected.size} ${selected.size === 1 ? 'item' : 'items'}?`}
        message="The archived articles and their highlights will be permanently deleted."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          void deleteSel()
        }}
      />
      <ConfirmModal
        open={!!ctxDelete}
        title="Delete item?"
        message="The archived article and its highlights will be permanently deleted."
        onCancel={() => setCtxDelete(null)}
        onConfirm={() => {
          if (ctxDelete) {
            void window.api?.atlas.remove(ctxDelete.id)
            toast('Deleted')
          }
          setCtxDelete(null)
        }}
      />
    </div>
  )
}

/* ================================================================ reader */

/** Wrap highlight occurrences inside one paragraph in clickable <mark>s. */
function markParagraph(text: string, highlights: AtlasHighlight[], onMark: (h: AtlasHighlight) => void): ReactNode[] {
  type Seg = string | { h: AtlasHighlight; text: string }
  let segs: Seg[] = [text]
  for (const h of [...highlights].sort((a, b) => b.text.length - a.text.length)) {
    const ht = h.text.trim()
    if (ht.length < 3 || ht.includes('\n')) continue
    segs = segs.flatMap((seg): Seg[] => {
      if (typeof seg !== 'string') return [seg]
      const parts: Seg[] = []
      let rest = seg
      let idx: number
      while ((idx = rest.indexOf(ht)) !== -1) {
        if (idx > 0) parts.push(rest.slice(0, idx))
        parts.push({ h, text: ht })
        rest = rest.slice(idx + ht.length)
      }
      if (rest) parts.push(rest)
      return parts
    })
  }
  return segs.map((s, i) =>
    typeof s === 'string' ? (
      s
    ) : (
      <mark key={i} className="hl" title={s.h.note || 'Highlight — click to annotate'} onClick={() => onMark(s.h)}>
        {s.text}
      </mark>
    ),
  )
}

type ReaderBlock =
  | { type: 'p' | 'quote' | 'h'; text: string; level?: number }
  | { type: 'ul'; items: string[] }
  | { type: 'img'; src: string; alt: string }

/**
 * Build the reader's blocks. URL articles carry structured markdown in `content`
 * (paragraphs, headings, quotes, lists, images); snippets and legacy items only have
 * plain `body`, which we render as simple paragraphs.
 */
function readerBlocks(item: AtlasItem): ReaderBlock[] {
  const md = item.content?.trim()
  if (!md) {
    return (item.body ?? '')
      .split(/\n+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text): ReaderBlock => ({ type: 'p', text }))
  }
  return md.split(/\n{2,}/).map((raw): ReaderBlock => {
    const b = raw.trim()
    const img = b.match(/^!\[([^\]]*)\]\((.+)\)$/)
    if (img) return { type: 'img', alt: img[1], src: img[2] }
    const h = b.match(/^(#{1,6})\s+([\s\S]+)$/)
    if (h) return { type: 'h', level: h[1].length, text: h[2].trim() }
    if (b.startsWith('>')) return { type: 'quote', text: b.replace(/^>\s?/gm, '').trim() }
    if (/^-\s/.test(b)) return { type: 'ul', items: b.split('\n').map((l) => l.replace(/^-\s+/, '').trim()).filter(Boolean) }
    return { type: 'p', text: b }
  })
}

function AskPanel({ item, onClose }: { item: AtlasItem; onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [input, setInput] = useState('')
  const [reqId, setReqId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const running = !!reqId

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = async () => {
    const api = window.api
    const text = input.trim()
    if (!text || running || !api?.chat) return
    setInput('')
    const history = [...messages, { role: 'user' as const, content: text }]
    setMessages([...history, { role: 'assistant', content: '' }])
    const id = crypto.randomUUID()
    setReqId(id)
    const system = [
      "You are Luna, answering questions about ONE article saved in the user's Atlas library.",
      'Ground every answer in the article text below. If the article does not cover something, say so plainly instead of guessing.',
      'Be concise. Never mention the underlying model or provider.',
      '',
      `TITLE: ${item.title}`,
      '',
      'ARTICLE:',
      (item.body ?? '').slice(0, 24_000),
    ].join('\n')
    try {
      await api.chat(
        { id, messages: [{ role: 'system', content: system }, ...history], temperature: 0.3, tools: false },
        (token) =>
          setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? { ...m, content: m.content + token } : m))),
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ask failed')
    } finally {
      setReqId(null)
      setMessages((ms) => (ms.at(-1)?.content === '' ? ms.slice(0, -1) : ms))
    }
  }

  return (
    <aside className="ask">
      <div className="ask-head">
        <span className="count">Ask about this article</span>
        <IconButton label="Close panel" onClick={onClose}>
          <XIcon />
        </IconButton>
      </div>
      <div className="ask-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="ask-empty">Luna answers from this article only — try “what’s the core argument?”</div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ask-q">
              {m.content}
            </div>
          ) : m.content ? (
            <div key={i} className="ask-a">
              <Markdown content={m.content} />
            </div>
          ) : (
            <div key={i} className="ask-a thinking-txt">
              thinking…
            </div>
          ),
        )}
      </div>
      <div className="ask-composer">
        <Input
          placeholder="Ask about this article…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
        />
        {running ? (
          <Button variant="secondary" small onClick={() => window.api?.cancelChat?.(reqId!)}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" small onClick={() => void send()} disabled={!input.trim()}>
            Ask
          </Button>
        )}
      </div>
    </aside>
  )
}

const hideImg = (e: { currentTarget: HTMLImageElement }) => {
  e.currentTarget.style.display = 'none'
}

/** Typed byline above the reader body: author/avatar/handle for posts, channel for video. */
function ReaderHead({ item }: { item: AtlasItem }) {
  const m = item.meta
  if (!m) return null

  if (item.mediaType === 'social') {
    const sub = [m.handle, m.siteName, fmtWhen(m.publishedAt)].filter(Boolean).join(' · ')
    return (
      <div className="reader-post-head">
        {m.avatar && <img className="reader-avatar" src={m.avatar} alt="" onError={hideImg} />}
        <div className="reader-post-who">
          {m.author && <b>{m.author}</b>}
          {sub && <i>{sub}</i>}
        </div>
      </div>
    )
  }

  if (item.mediaType === 'video') {
    return (
      <div className="reader-post-head">
        <div className="reader-post-who">
          {m.author && <b>{m.author}</b>}
          <i>{m.siteName ?? 'Video'}</i>
        </div>
        {item.url && (
          <a className="reader-stub-open" href={item.url} target="_blank" rel="noreferrer">
            ▶ Watch ↗
          </a>
        )}
      </div>
    )
  }

  // a PDF with an extracted text layer reads like an article — badge it + offer the file
  if (item.mediaType === 'pdf' && item.content) {
    return (
      <div className="reader-post-head">
        <div className="reader-post-who">
          <b>PDF</b>
          {m.pages && <i>{m.pages} {m.pages === 1 ? 'page' : 'pages'}</i>}
        </div>
        {item.url && (
          <a className="reader-stub-open" href={item.url} target="_blank" rel="noreferrer">
            Open PDF ↗
          </a>
        )}
      </div>
    )
  }

  // a saved local document — badge its type + offer to open the original on disk
  if (item.mediaType === 'file') {
    const sub = [m.pages ? `${m.pages} ${m.pages === 1 ? 'page' : 'pages'}` : null].filter(Boolean).join(' · ')
    return (
      <div className="reader-post-head">
        <div className="reader-post-who">
          <b>{(m.fileType || 'file').toUpperCase()}</b>
          {sub && <i>{sub}</i>}
        </div>
        {m.sourcePath && (
          <button className="reader-stub-open" onClick={() => void window.api?.files?.reveal(m.sourcePath!)}>
            Open file ↗
          </button>
        )}
      </div>
    )
  }

  return null
}

/** Graceful-failure card for stub / pdf items: hero + excerpt + an open-original action. */
function ReaderStub({ item }: { item: AtlasItem }) {
  const hero = item.meta?.hero
  const isPdf = item.mediaType === 'pdf'
  return (
    <div className="reader-stub">
      {hero && <img src={hero} alt="" onError={hideImg} />}
      {item.excerpt && <p>{item.excerpt}</p>}
      <p className="reader-stub-note">
        {isPdf
          ? 'No text layer to read — this PDF looks scanned or image-only. Open it directly:'
          : 'This page couldn’t be read in full — it may need a login or block readers.'}
      </p>
      {item.url && (
        <a className="reader-stub-open" href={item.url} target="_blank" rel="noreferrer">
          Open {isPdf ? 'PDF' : 'original'} ↗
        </a>
      )}
    </div>
  )
}

function Reader({ id }: { id: string }) {
  const openReader = useAtlas((s) => s.openReader)
  const addTask = useOrbit((s) => s.addTask)
  const addNote = useOrbit((s) => s.addNote)
  const updateNote = useOrbit((s) => s.updateNote)

  const [item, setItem] = useState<AtlasItem | null>(null)
  const [highlights, setHighlights] = useState<AtlasHighlight[]>([])
  const [related, setRelated] = useState<AtlasItem[]>([])
  const [missing, setMissing] = useState(false)
  const [digesting, setDigesting] = useState(false)
  const [hasKey, setHasKey] = useState(true)
  const [askOpen, setAskOpen] = useState(false)
  const [selBtn, setSelBtn] = useState<{ x: number; y: number; text: string } | null>(null)
  const [editHl, setEditHl] = useState<AtlasHighlight | null>(null)
  const [hlNote, setHlNote] = useState('')
  const [taskText, setTaskText] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  const scrollTimer = useRef(0)

  const load = useCallback(async () => {
    const res = await window.api?.atlas.get(id)
    if (!res) {
      setMissing(true)
      return
    }
    setItem(res.item)
    setHighlights(res.highlights)
    setRelated(await window.api!.atlas.related(id))
  }, [id])

  useEffect(() => {
    restored.current = false
    setAskOpen(false)
    setMissing(false)
    setItem(null)
    void load()
    window.api?.hasKey('llm-main').then(setHasKey).catch(() => {})
  }, [load])

  // opening an unread item starts it — done stays a deliberate click
  useEffect(() => {
    if (item?.status === 'unread') {
      void window.api?.atlas.update(id, { status: 'reading' })
      setItem((it) => (it ? { ...it, status: 'reading' } : it))
    }
  }, [item?.status, id])

  // restore the reading position once the body has rendered
  useEffect(() => {
    if (!item || restored.current) return
    restored.current = true
    const el = scrollRef.current
    if (el && item.scroll > 0) el.scrollTop = item.scroll * (el.scrollHeight - el.clientHeight)
  }, [item])

  const onScroll = () => {
    setSelBtn(null)
    const el = scrollRef.current
    if (el && progressRef.current) {
      const max = el.scrollHeight - el.clientHeight
      progressRef.current.style.transform = `scaleX(${max > 0 ? Math.min(1, el.scrollTop / max) : 0})`
    }
    window.clearTimeout(scrollTimer.current)
    scrollTimer.current = window.setTimeout(() => {
      if (!el) return
      const max = el.scrollHeight - el.clientHeight
      void window.api?.atlas.update(id, { scroll: max > 0 ? el.scrollTop / max : 0 })
    }, 400)
  }

  const onMouseUp = () => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (!text || !sel || sel.rangeCount === 0) {
      setSelBtn(null)
      return
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    setSelBtn({ x: rect.left + rect.width / 2, y: rect.top, text })
  }

  const addHl = async () => {
    if (!selBtn) return
    const h = await window.api?.atlas.addHighlight(id, selBtn.text)
    if (h) setHighlights((hs) => [...hs, h])
    setSelBtn(null)
    window.getSelection()?.removeAllRanges()
  }

  const digest = async () => {
    setDigesting(true)
    const res = await window.api?.atlas.digest(id)
    setDigesting(false)
    if (!res) return
    // digest returns the item WITHOUT its body (list-shape row); keep the body/content we
    // already have so the document viewer doesn't blank out after summarizing.
    setItem((prev) => (prev ? { ...prev, ...res.item, body: res.item.body ?? prev.body, content: res.item.content ?? prev.content } : res.item))
    if (res.warning) toast(res.warning)
  }

  const cycleStatus = async () => {
    if (!item) return
    const status = NEXT_STATUS[item.status]
    setItem({ ...item, status })
    await window.api?.atlas.update(id, { status })
  }

  const toggleQueue = async () => {
    if (!item) return
    const queuedAt = item.queuedAt === null ? Date.now() : null
    setItem({ ...item, queuedAt })
    await window.api?.atlas.update(id, { queuedAt })
    toast(queuedAt ? 'Added to Up next' : 'Removed from Up next')
  }

  const noteToOrbit = () => {
    if (!item) return
    const noteId = addNote()
    const body = [
      item.summary,
      item.keyPoints.length ? item.keyPoints.map((k) => `- ${k}`).join('\n') : null,
      item.url,
    ]
      .filter(Boolean)
      .join('\n\n')
    updateNote(noteId, { title: item.title, body: body || (item.body ?? '').slice(0, 600) })
    toast('Saved to Orbit notes')
  }

  const exportMd = async () => {
    const res = await window.api?.atlas.exportItems([id])
    if (res?.ok) toast('Exported')
    else if (res && !res.canceled) toast(res.error ?? 'Export failed')
  }

  if (missing) {
    return (
      <div className="panel atlas-panel">
        <Empty label="Item not found" hint="It may have been deleted." />
        <Button variant="secondary" small onClick={() => openReader(null)} style={{ alignSelf: 'center' }}>
          Back to library
        </Button>
      </div>
    )
  }
  if (!item) return null

  const meta = [item.domain ?? 'snippet', fmt(item.savedAt), item.wordCount ? `${item.wordCount} words · ${readTime(item.wordCount)}` : null]
    .filter(Boolean)
    .join(' · ')
  const blocks = readerBlocks(item)
  // a filed local document with a vaulted copy renders in the built-in viewer instead of as text
  const showDoc = hasVaultFile(item)
  const mark = (t: string) =>
    markParagraph(t, highlights, (h) => {
      setEditHl(h)
      setHlNote(h.note)
    })

  return (
    <div className={'reader' + (askOpen ? ' ask-open' : '')}>
      <div className="reader-progress" ref={progressRef} />
      <div className="reader-scroll scroll-y" ref={scrollRef} onScroll={onScroll}>
        <div className={'reader-col' + (showDoc ? ' reader-col--doc' : '')}>
          <div className="reader-bar">
            <button className="m-back" onClick={() => openReader(null)}>
              ‹ Library
            </button>
            <div className="reader-actions">
              <button className="status-pill" onClick={() => void cycleStatus()} title="Cycle read status">
                <Badge variant={item.status === 'done' ? 'solid' : 'outline'}>{item.status}</Badge>
              </button>
              <IconButton
                label={item.queuedAt !== null ? 'Remove from Up next' : 'Add to Up next'}
                className={'pin-btn' + (item.queuedAt !== null ? ' on' : '')}
                onClick={() => void toggleQueue()}
              >
                <PinIcon />
              </IconButton>
              <Button variant={askOpen ? 'primary' : 'secondary'} small onClick={() => setAskOpen((o) => !o)}>
                Ask Luna
              </Button>
              <Menu
                trigger={<Button variant="ghost" small>More</Button>}
                items={[
                  { label: 'Task in Orbit', onSelect: () => setTaskText(`Follow up: ${item.title}`) },
                  { label: 'Note to Orbit', onSelect: noteToOrbit },
                  { label: 'Export Markdown', onSelect: () => void exportMd() },
                  'sep',
                  { label: 'Delete', danger: true, onSelect: () => setConfirmDelete(true) },
                ]}
              />
            </div>
          </div>

          <ReaderHead item={item} />

          <h2 className="reader-title">{item.title}</h2>
          <div className="reader-meta">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer">
                {meta}
              </a>
            ) : (
              meta
            )}
          </div>

          {(item.tags.length > 0 || item.shelf === 'research') && (
            <div className="reader-tags">
              {item.shelf === 'research' && <Badge variant="outline">research</Badge>}
              {item.tags.map((t) => (
                <Badge key={t} variant="subtle">
                  {t}
                </Badge>
              ))}
            </div>
          )}

          {item.summary ? (
            <div className="reader-digest">
              <div className="m-sub">Summary</div>
              <p>{item.summary}</p>
              {item.keyPoints.length > 0 && (
                <ul>
                  {item.keyPoints.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              )}
              {item.quotes.map((q, i) => (
                <blockquote key={i}>{q}</blockquote>
              ))}
            </div>
          ) : (
            (item.mediaType === 'article' || item.mediaType === 'file' || (item.mediaType === 'pdf' && !!item.content)) &&
            item.body?.trim() && (
              <div className="reader-digest reader-digest--none">
                <span className="count">No summary yet</span>
                <Button variant="secondary" small onClick={() => void digest()} disabled={digesting || !hasKey}
                  title={hasKey ? undefined : 'Needs an API key (Settings)'}>
                  {digesting ? 'Summarizing…' : 'Summarize'}
                </Button>
              </div>
            )
          )}

          {showDoc ? (
            <DocViewer item={item} />
          ) : item.mediaType === 'stub' || (item.mediaType === 'pdf' && !item.content) ? (
            <ReaderStub item={item} />
          ) : (
          <div className="reader-body" onMouseUp={onMouseUp}>
            {blocks.map((b, i) => {
              if (b.type === 'img')
                return (
                  <figure key={i} className="reader-fig">
                    <img
                      src={b.src}
                      alt={b.alt}
                      loading="lazy"
                      title="Click to expand"
                      onClick={() => setLightbox({ src: b.src, alt: b.alt })}
                      onError={(e) => {
                        const fig = e.currentTarget.closest('figure')
                        if (fig) (fig as HTMLElement).style.display = 'none'
                      }}
                    />
                    {b.alt && <figcaption>{b.alt}</figcaption>}
                  </figure>
                )
              if (b.type === 'ul')
                return (
                  <ul key={i} className="reader-ul">
                    {b.items.map((it, j) => (
                      <li key={j}>{mark(it)}</li>
                    ))}
                  </ul>
                )
              if (b.type === 'h')
                return (
                  <p key={i} className={`reader-h reader-h${Math.min(b.level ?? 2, 4)}`}>
                    {mark(b.text)}
                  </p>
                )
              if (b.type === 'quote')
                return (
                  <blockquote key={i} className="reader-bq">
                    {mark(b.text)}
                  </blockquote>
                )
              return <p key={i}>{mark(b.text)}</p>
            })}
          </div>
          )}

          {highlights.length > 0 && (
            <div className="reader-hls">
              <div className="m-sub">Highlights · {highlights.length}</div>
              {highlights.map((h) => (
                <button
                  key={h.id}
                  className="reader-hl-row"
                  onClick={() => {
                    setEditHl(h)
                    setHlNote(h.note)
                  }}
                >
                  <span className="reader-hl-text">{h.text}</span>
                  {h.note && <span className="reader-hl-note">{h.note}</span>}
                </button>
              ))}
            </div>
          )}

          {related.length > 0 && (
            <div className="reader-related">
              <div className="m-sub">Related in your library</div>
              <div className="related-row">
                {related.map((r) => (
                  <button key={r.id} className="related-card" onClick={() => openReader(r.id)}>
                    <b>{r.title}</b>
                    <i>{r.domain ?? 'snippet'}</i>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {askOpen && <AskPanel item={item} onClose={() => setAskOpen(false)} />}

      {selBtn && (
        <button
          className="hl-float"
          style={{ left: selBtn.x, top: selBtn.y - 40 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void addHl()}
        >
          Highlight
        </button>
      )}

      <Modal
        open={!!editHl}
        onClose={() => setEditHl(null)}
        title="Highlight"
        actions={
          editHl && (
            <>
              <Button
                variant="danger"
                small
                onClick={async () => {
                  await window.api?.atlas.removeHighlight(editHl.id)
                  setHighlights((hs) => hs.filter((h) => h.id !== editHl.id))
                  setEditHl(null)
                }}
              >
                Delete
              </Button>
              <Button
                variant="primary"
                small
                onClick={async () => {
                  await window.api?.atlas.noteHighlight(editHl.id, hlNote)
                  setHighlights((hs) => hs.map((h) => (h.id === editHl.id ? { ...h, note: hlNote } : h)))
                  setEditHl(null)
                }}
              >
                Save
              </Button>
            </>
          )
        }
      >
        {editHl && (
          <div className="note-edit">
            <blockquote className="hl-quote">{editHl.text}</blockquote>
            <Textarea placeholder="Add a margin note…" rows={3} value={hlNote} onChange={(e) => setHlNote(e.target.value)} />
          </div>
        )}
      </Modal>

      <Modal
        open={taskText !== null}
        onClose={() => setTaskText(null)}
        title="Task in Orbit"
        actions={
          <>
            <Button variant="secondary" small onClick={() => setTaskText(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              small
              disabled={!taskText?.trim()}
              onClick={() => {
                addTask(taskText!.trim())
                setTaskText(null)
                toast('Task added to Orbit')
              }}
            >
              Add task
            </Button>
          </>
        }
      >
        <Input value={taskText ?? ''} onChange={(e) => setTaskText(e.target.value)} />
      </Modal>

      <ConfirmModal
        open={confirmDelete}
        title="Delete this item?"
        message="The archived article and its highlights will be permanently deleted."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false)
          await window.api?.atlas.remove(id)
          openReader(null)
        }}
      />

      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
    </div>
  )
}

/* ================================================================ highlights tab */

function HighlightsTab() {
  const openReader = useAtlas((s) => s.openReader)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<AtlasHighlight[]>([])
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRows((await window.api?.atlas.highlights(query.trim() || undefined)) ?? [])
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="panel atlas-panel">
      <Input placeholder="Search highlights and notes…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {rows.length === 0 ? (
        <Empty
          label={query ? 'No matches' : 'No highlights yet'}
          hint={query ? 'Nothing highlighted fits that search.' : 'Select text while reading to highlight it.'}
        />
      ) : (
        <div className="hl-list">
          {rows.map((h) => (
            <div
              key={h.id}
              className="hl-row"
              onContextMenu={(e) =>
                openContextMenu(e, [
                  { label: 'Open in reader', onSelect: () => openReader(h.itemId) },
                  { label: 'Copy text', onSelect: () => void navigator.clipboard.writeText(h.text).then(() => toast('Copied')) },
                  'sep',
                  { label: 'Delete highlight', danger: true, onSelect: () => setConfirmDelete(h.id) },
                ])
              }
            >
              <button className="hl-row-main" onClick={() => openReader(h.itemId)}>
                <span className="reader-hl-text">{h.text}</span>
                {h.note && <span className="reader-hl-note">{h.note}</span>}
                <i>{h.itemTitle}</i>
              </button>
              <IconButton label="Delete highlight" className="row-del" onClick={() => setConfirmDelete(h.id)}>
                <XIcon />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <ConfirmModal
        open={!!confirmDelete}
        title="Delete highlight?"
        message="This highlight and its note will be permanently deleted."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await window.api?.atlas.removeHighlight(confirmDelete)
          setConfirmDelete(null)
          void load()
        }}
      />
    </div>
  )
}

/* ================================================================ view */

export default function Atlas() {
  const loaded = useAtlas((s) => s.loaded)
  const refresh = useAtlas((s) => s.refresh)
  const readingId = useAtlas((s) => s.readingId)
  const openReader = useAtlas((s) => s.openReader)
  const [tab, setTab] = useState<Tab>('library')
  const [hasKey, setHasKey] = useState(true)

  useEffect(() => {
    if (!loaded) void refresh()
    window.api?.hasKey('llm-main').then(setHasKey).catch(() => {})
  }, [loaded, refresh])

  return (
    <div className="view view--orbit view--atlas" id="atlas">
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
            <span className="orbit-orb atlas-orb" />
            <div className="orbit-id-txt">
              <h1>Atlas</h1>
              <p>library · reader · research</p>
            </div>
          </div>

          <Segmented
            options={[
              { id: 'library', label: 'Library' },
              { id: 'highlights', label: 'Highlights' },
            ]}
            value={readingId ? '' : tab}
            onChange={(id) => {
              openReader(null)
              setTab(id as Tab)
            }}
          />
        </div>
      </header>

      <div className="orbit-body scroll-y atlas-body">
        {readingId ? <Reader key={readingId} id={readingId} /> : tab === 'library' ? <Library hasKey={hasKey} /> : <HighlightsTab />}
      </div>
    </div>
  )
}
