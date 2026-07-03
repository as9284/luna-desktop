/**
 * Minimal, dependency-light .pptx reader. A .pptx is a zip of XML parts; we crack it with
 * fflate and pull two things out:
 *   - extractPptxText(bytes) → plain text of every slide, in order (for search / LLM digest)
 *   - pptxSlides(bytes)      → a positioned render model (text boxes + images placed by their
 *                              real slide coordinates) for the built-in slide viewer
 *
 * This is a best-effort renderer, not a full PowerPoint engine: it handles text boxes and
 * pictures positioned by their `a:xfrm`, basic run styling (size / bold / italic / colour /
 * alignment) and embedded raster images. Gradients, SmartArt, charts, tables and animations
 * are out of scope — a deck that leans on those still reads fine as text and can be opened
 * externally. Everything is wrapped so a malformed part degrades to "skip that shape".
 *
 * Pure (no electron import) so it stays unit-testable under plain Node, like extract.ts.
 */

const EMU_PER_PX = 9525 // 914400 EMU/inch ÷ 96 px/inch
const PT_TO_PX = 96 / 72

export interface PptxRun {
  text: string
  size?: number // px
  bold?: boolean
  italic?: boolean
  color?: string // css color
}
export interface PptxPara {
  align?: 'left' | 'center' | 'right' | 'justify'
  runs: PptxRun[]
}
export type PptxShape =
  | { type: 'text'; x: number; y: number; w: number; h: number; paras: PptxPara[] }
  | { type: 'image'; x: number; y: number; w: number; h: number; src: string }
export interface PptxSlide {
  /** slide canvas size in virtual px */
  w: number
  h: number
  shapes: PptxShape[]
}

async function unzip(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  const { unzipSync } = (await import('fflate')) as typeof import('fflate')
  return unzipSync(bytes)
}

const dec = (u8: Uint8Array | undefined): string => (u8 ? new TextDecoder('utf-8').decode(u8) : '')

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')

const attr = (tag: string, name: string): string | undefined => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
  return m ? m[1] : undefined
}

/** Ordered list of slide part names (e.g. "ppt/slides/slide1.xml") from the presentation. */
function slideOrder(files: Record<string, Uint8Array>): string[] {
  const present = dec(files['ppt/presentation.xml'])
  const rels = dec(files['ppt/_rels/presentation.xml.rels'])
  const relMap = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id && target) relMap.set(id, target.replace(/^\/?/, '').replace(/^ppt\//, ''))
  }
  const order: string[] = []
  for (const m of present.matchAll(/<p:sldId\b[^>]*>/g)) {
    const rid = attr(m[0], 'r:id')
    const target = rid ? relMap.get(rid) : undefined
    if (target) order.push(`ppt/${target}`.replace(/ppt\/\.\.\//, ''))
  }
  // fall back to numeric filename order if the presentation didn't resolve
  if (!order.length) {
    return Object.keys(files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => (parseInt(a.match(/(\d+)/)![1]) || 0) - (parseInt(b.match(/(\d+)/)![1]) || 0))
  }
  return order
}

function slideSize(files: Record<string, Uint8Array>): { w: number; h: number } {
  const m = dec(files['ppt/presentation.xml']).match(/<p:sldSz\b[^>]*>/)
  const cx = m && attr(m[0], 'cx')
  const cy = m && attr(m[0], 'cy')
  return {
    w: cx ? Math.round(Number(cx) / EMU_PER_PX) : 960,
    h: cy ? Math.round(Number(cy) / EMU_PER_PX) : 540,
  }
}

const SCHEME: Record<string, string> = {
  tx1: '#111', dk1: '#111', tx2: '#333', dk2: '#333',
  bg1: '#fff', lt1: '#fff', bg2: '#eee', lt2: '#eee',
}

function parseXfrm(xml: string): { x: number; y: number; w: number; h: number } | null {
  const off = xml.match(/<a:off\b[^>]*>/)
  const ext = xml.match(/<a:ext\b[^>]*>/)
  if (!off || !ext) return null
  const x = Number(attr(off[0], 'x'))
  const y = Number(attr(off[0], 'y'))
  const w = Number(attr(ext[0], 'cx'))
  const h = Number(attr(ext[0], 'cy'))
  if ([x, y, w, h].some((n) => !Number.isFinite(n))) return null
  return { x: x / EMU_PER_PX, y: y / EMU_PER_PX, w: w / EMU_PER_PX, h: h / EMU_PER_PX }
}

function colorOf(rPr: string): string | undefined {
  const srgb = rPr.match(/<a:srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"/)
  if (srgb) return `#${srgb[1]}`
  const scheme = rPr.match(/<a:schemeClr\b[^>]*val="([^"]+)"/)
  if (scheme) return SCHEME[scheme[1]]
  return undefined
}

function parseParagraph(pXml: string): PptxPara {
  const pPr = pXml.match(/<a:pPr\b[^>]*>/)?.[0] ?? ''
  const algn = attr(pPr, 'algn')
  const align =
    algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : algn === 'l' ? 'left' : undefined
  const runs: PptxRun[] = []
  for (const rm of pXml.matchAll(/<a:r\b[\s\S]*?<\/a:r>/g)) {
    const run = rm[0]
    const t = run.match(/<a:t>([\s\S]*?)<\/a:t>/)
    if (!t) continue
    const rPr = run.match(/<a:rPr\b[\s\S]*?(?:\/>|<\/a:rPr>)/)?.[0] ?? ''
    const sz = attr(rPr, 'sz')
    runs.push({
      text: unescapeXml(t[1]),
      size: sz ? Math.round((Number(sz) / 100) * PT_TO_PX) : undefined,
      bold: attr(rPr, 'b') === '1' || undefined,
      italic: attr(rPr, 'i') === '1' || undefined,
      color: colorOf(rPr),
    })
  }
  return { align, runs }
}

async function slideModel(files: Record<string, Uint8Array>, part: string): Promise<PptxSlide | null> {
  const xml = dec(files[part])
  if (!xml) return null
  const { w, h } = slideSize(files)

  // slide → media relationships (r:embed → ../media/imageN.png)
  const relPart = part.replace(/slides\/([^/]+)$/, 'slides/_rels/$1.rels')
  const relXml = dec(files[relPart])
  const rel = new Map<string, string>()
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id && target) rel.set(id, ('ppt/slides/' + target).replace(/\/[^/]+\/\.\.\//g, '/'))
  }

  const shapes: PptxShape[] = []
  // sp (text box) and pic (image), in document order (z-order)
  for (const m of xml.matchAll(/<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g)) {
    try {
      const node = m[0]
      const box = parseXfrm(node)
      if (!box) continue
      if (m[1] === 'pic') {
        const embed = node.match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1]
        const mediaPath = embed ? rel.get(embed) : undefined
        const media = mediaPath ? files[mediaPath] : undefined
        if (!media || media.byteLength > 8 * 1024 * 1024) continue
        const ext = (mediaPath!.match(/\.(\w+)$/)?.[1] ?? 'png').toLowerCase()
        const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext
        const b64 = Buffer.from(media).toString('base64')
        shapes.push({ type: 'image', ...box, src: `data:image/${mime};base64,${b64}` })
      } else {
        const body = node.match(/<p:txBody>[\s\S]*<\/p:txBody>/)?.[0]
        if (!body) continue
        const paras = [...body.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((pm) => parseParagraph(pm[0]))
        if (paras.every((p) => p.runs.every((r) => !r.text.trim()))) continue
        shapes.push({ type: 'text', ...box, paras })
      }
    } catch {
      /* skip a shape we can't parse */
    }
  }
  return { w, h, shapes }
}

/** Positioned slide model for the viewer. Returns [] if the file isn't a readable pptx. */
export async function pptxSlides(bytes: Uint8Array): Promise<PptxSlide[]> {
  try {
    const files = await unzip(bytes)
    const order = slideOrder(files)
    const out: PptxSlide[] = []
    for (const part of order) {
      const s = await slideModel(files, part)
      if (s) out.push(s)
    }
    return out
  } catch {
    return []
  }
}

/** Plain text of every slide, in order, for search / digest. */
export async function extractPptxText(bytes: Uint8Array): Promise<string> {
  const files = await unzip(bytes)
  const parts: string[] = []
  slideOrder(files).forEach((part, i) => {
    const xml = dec(files[part])
    const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unescapeXml(m[1])).join(' ').replace(/\s+/g, ' ').trim()
    if (text) parts.push(`# Slide ${i + 1}\n${text}`)
  })
  return parts.join('\n\n')
}
