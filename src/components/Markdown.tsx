import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark-dimmed.css'

const CopyIcon = () => (
  <svg viewBox="0 0 14 14">
    <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
    <path d="M9.5 4.5v-1a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3.5v4A1.5 1.5 0 0 0 4 9h.5" />
  </svg>
)
const CheckIcon = () => (
  <svg viewBox="0 0 14 14">
    <path d="M3 7.5l2.5 2.5L11 4.5" />
  </svg>
)

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={'copybtn' + (copied ? ' copied' : '')}
      aria-label={label}
      title={label}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? 'Copied' : ''}
    </button>
  )
}

// pull the raw text back out of a rendered code block for the copy button
const nodeText = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return nodeText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

function Pre({ children }: { children?: ReactNode }) {
  let lang = ''
  if (children && typeof children === 'object' && 'props' in children) {
    const cls: string = (children as { props: { className?: string } }).props.className ?? ''
    lang = cls.match(/language-([\w+-]+)/)?.[1] ?? ''
  }
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span className="codeblock-lang">{lang || 'code'}</span>
        <CopyButton text={nodeText(children)} label="Copy code" />
      </div>
      <pre>{children}</pre>
    </div>
  )
}

/** Tiny inline "save this link to Atlas" affordance next to links in chat answers. */
function SaveLink({ href }: { href: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const save = async () => {
    if (state !== 'idle') return
    setState('saving')
    try {
      const res = await window.api?.atlas.saveUrl(href)
      if (res?.ok && res.item) {
        setState('saved')
        // summarize in the background; the item is already archived either way
        if (!res.existed && !res.item.summary) void window.api?.atlas.digest(res.item.id).catch(() => {})
      } else {
        setState('idle')
      }
    } catch {
      setState('idle')
    }
  }
  return (
    <button
      className={'md-save' + (state === 'saved' ? ' saved' : '')}
      title={state === 'saved' ? 'Saved to Atlas' : 'Save to Atlas'}
      aria-label="Save link to Atlas"
      onClick={save}
      disabled={state !== 'idle'}
    >
      {state === 'saving' ? '…' : state === 'saved' ? '✓' : '+'}
    </button>
  )
}

const Markdown = memo(function Markdown({ content, saveLinks }: { content: string; saveLinks?: boolean }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: Pre,
          a: ({ href, children }) => (
            <>
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
              {saveLinks && href && /^https?:\/\//.test(href) && <SaveLink href={href} />}
            </>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

export default Markdown
