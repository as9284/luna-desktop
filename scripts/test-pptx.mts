/**
 * Backend reliability harness for the .pptx reader (electron/luna/pptx.ts) and its wiring into
 * extractDocument. Run: npx tsx scripts/test-pptx.mts
 *
 * Builds a REAL .pptx (a zip of the same XML parts PowerPoint emits) with a styled text box and
 * an embedded PNG, then checks text extraction, the positioned slide model, and graceful
 * degradation on a non-pptx / empty deck.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
// @ts-expect-error — jszip has no bundled types here; runtime only
import JSZip from 'jszip'
import { extractPptxText, pptxSlides } from '../electron/luna/pptx'
import { extractDocument } from '../electron/luna/extract'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`) }
}
const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`)

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function makePptx(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`)
  zip.folder('_rels')!.file('.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)
  const ppt = zip.folder('ppt')!
  ppt.file('presentation.xml',
    `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/></p:presentation>`)
  ppt.folder('_rels')!.file('presentation.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`)
  ppt.folder('slides')!.file('slide1.xml',
    `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>` +
    `<p:sp><p:spPr><a:xfrm><a:off x="838200" y="365760"/><a:ext cx="7772400" cy="1470025"/></a:xfrm></p:spPr><p:txBody><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4000" b="1"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>Hello Deck</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="3000000" cy="2000000"/></a:xfrm></p:spPr></p:pic>` +
    `</p:spTree></p:cSld></p:sld>`)
  ppt.folder('slides')!.folder('_rels')!.file('slide1.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`)
  ppt.folder('media')!.file('image1.png', PNG)
  return zip.generateAsync({ type: 'uint8array' })
}

async function main() {
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-pptx-'))
  const bytes = await makePptx()
  const file = path.join(DIR, 'deck.pptx')
  fs.writeFileSync(file, bytes)

  section('extractPptxText')
  const text = await extractPptxText(bytes)
  ok('extracts slide text', text.includes('Hello Deck'), JSON.stringify(text))
  ok('labels slide number', /# Slide 1/.test(text))

  section('pptxSlides — positioned model')
  const slides = await pptxSlides(bytes)
  ok('one slide', slides.length === 1, `got ${slides.length}`)
  const s = slides[0]
  ok('slide size in px (4:3 = 960×720)', s?.w === 960 && s?.h === 720, `${s?.w}×${s?.h}`)
  ok('two shapes (text + image)', s?.shapes.length === 2, `got ${s?.shapes.length}`)
  const tb = s?.shapes.find((x) => x.type === 'text')
  const run = tb?.type === 'text' ? tb.paras[0]?.runs[0] : undefined
  ok('text run content', run?.text === 'Hello Deck', run?.text)
  ok('bold parsed', run?.bold === true)
  ok('colour parsed', run?.color === '#FF0000', run?.color)
  ok('font size → px (~53)', !!run?.size && run.size > 45 && run.size < 60, String(run?.size))
  ok('paragraph alignment centre', tb?.type === 'text' && tb.paras[0]?.align === 'center')
  ok('text box positioned', tb?.type === 'text' && tb.x > 80 && tb.x < 95, String(tb?.type === 'text' && tb.x))
  const img = s?.shapes.find((x) => x.type === 'image')
  ok('image embedded as data URL', img?.type === 'image' && img.src.startsWith('data:image/png;base64,'))

  section('extractDocument routing (.pptx)')
  const ex = await extractDocument(file)
  ok('ok + kind pptx', ex.ok && ex.kind === 'pptx')
  ok('body has slide text', ex.text.includes('Hello Deck'))
  ok('meta slide count = 1', ex.meta?.slides === 1, String(ex.meta?.slides))

  section('graceful degradation')
  const empty = await pptxSlides(new Uint8Array([1, 2, 3, 4]))
  ok('non-pptx → [] (no throw)', Array.isArray(empty) && empty.length === 0)

  fs.rmSync(DIR, { recursive: true, force: true })
  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} passed, ${fail} failed\x1b[0m`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
