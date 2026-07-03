/** Shared helpers for the built-in document viewer. */

export type DocKind = 'pdf' | 'image' | 'docx' | 'sheet' | 'slides' | 'markdown' | 'code' | 'csv' | 'text'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'])
const CODE = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs',
  'php', 'swift', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'r', 'lua', 'pl', 'dart', 'vue', 'svelte', 'astro', 'graphql',
  'proto', 'html', 'htm', 'css', 'scss', 'less', 'json', 'jsonc', 'xml', 'yaml', 'yml', 'toml', 'ini',
])

/** Decide which viewer to render an item with, from its file type (and media type as a hint). */
export function docKind(item: AtlasItem): DocKind {
  const ft = (item.meta?.fileType || '').toLowerCase()
  if (item.mediaType === 'image' || IMAGE.has(ft)) return 'image'
  if (ft === 'pdf' || item.mediaType === 'pdf') return 'pdf'
  if (ft === 'docx') return 'docx'
  if (ft === 'xlsx' || ft === 'xlsm') return 'sheet'
  if (ft === 'csv' || ft === 'tsv') return 'csv'
  if (ft === 'pptx') return 'slides'
  if (ft === 'md' || ft === 'markdown') return 'markdown'
  if (CODE.has(ft)) return 'code'
  return 'text'
}

/** Does an item have a vaulted copy the viewer can render? */
export const hasVaultFile = (item: AtlasItem): boolean => !!item.meta?.vaultFile

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Strip any find highlights we injected, restoring the original text nodes. */
export function clearMarks(container: HTMLElement): void {
  const marks = container.querySelectorAll('mark.doc-find')
  marks.forEach((m) => {
    const parent = m.parentNode
    if (!parent) return
    parent.replaceChild(document.createTextNode(m.textContent ?? ''), m)
    parent.normalize()
  })
}

/**
 * Wrap every case-insensitive occurrence of `query` inside `container` in <mark class="doc-find">
 * and return the mark elements in document order. Used by every DOM-rendered viewer (pdf text
 * layer, docx, code, markdown, text, csv, sheets) for a uniform "find in document".
 */
export function markMatches(container: HTMLElement, query: string): HTMLElement[] {
  clearMarks(container)
  const q = query.trim()
  if (!q) return []
  const re = new RegExp(escapeRegExp(q), 'gi')
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      const el = node.parentElement
      if (!el || el.closest('script,style,mark.doc-find')) return NodeFilter.FILTER_REJECT
      return re.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const targets: Text[] = []
  while (walker.nextNode()) targets.push(walker.currentNode as Text)

  const marks: HTMLElement[] = []
  for (const node of targets) {
    const text = node.nodeValue!
    re.lastIndex = 0
    const frag = document.createDocumentFragment()
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
      const mark = document.createElement('mark')
      mark.className = 'doc-find'
      mark.textContent = m[0]
      frag.appendChild(mark)
      marks.push(mark)
      last = m.index + m[0].length
      if (m[0].length === 0) re.lastIndex++ // guard against zero-width loops
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    node.parentNode?.replaceChild(frag, node)
  }
  return marks
}
