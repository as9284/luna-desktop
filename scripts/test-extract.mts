/**
 * Backend reliability harness for document extraction.
 * Run: npx tsx scripts/test-extract.mts
 *
 * Generates REAL fixtures (docx via jszip, xlsx via exceljs, a hand-built PDF, plus text /
 * code / csv / json / binary) and runs them through extractDocument(), checking both correct
 * extraction and graceful degradation on corrupt / oversized / binary input.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
// @ts-expect-error — jszip has no bundled types here; runtime only
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { extractDocument } from '../electron/luna/extract'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`) }
}
const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`)

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-extract-'))
const p = (name: string) => path.join(DIR, name)

// ---- fixture builders -----------------------------------------------------
function makeMinimalPdf(text: string): Buffer {
  const esc = text.replace(/[()\\]/g, '\\$&')
  const stream = `BT /F1 24 Tf 72 700 Td (${esc}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((o) => { pdf += String(o).padStart(10, '0') + ' 00000 n \n' })
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

async function makeDocx(paras: string[]): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
  zip.folder('_rels')!.file('.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  const body = paras.map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join('')
  zip.folder('word')!.file('document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function makeXlsx(file: string) {
  const wb = new ExcelJS.Workbook()
  const s = wb.addWorksheet('Data')
  s.addRow(['name', 'score'])
  s.addRow(['Ada', 91])
  s.addRow(['Grace', 88])
  await wb.xlsx.writeFile(file)
}

// ---- run ------------------------------------------------------------------
section('Plain text / code / data')
{
  await fsp.writeFile(p('note.txt'), 'Just a plain note.\nLine two.')
  const r = await extractDocument(p('note.txt'))
  ok('.txt extracts as text', r.ok && r.kind === 'text' && r.text.includes('plain note'), JSON.stringify(r))
}
{
  await fsp.writeFile(p('app.ts'), 'export const answer = 42\n')
  const r = await extractDocument(p('app.ts'))
  ok('.ts extracts as code', r.ok && r.kind === 'code' && r.text.includes('answer = 42'), JSON.stringify(r))
}
{
  await fsp.writeFile(p('data.json'), '{"a":1,"b":[2,3]}')
  const r = await extractDocument(p('data.json'))
  ok('.json extracts as data', r.ok && r.kind === 'data' && r.text.includes('"b"'), JSON.stringify(r))
}
{
  await fsp.writeFile(p('rows.csv'), 'a,b,c\n1,2,3\n')
  const r = await extractDocument(p('rows.csv'))
  ok('.csv extracts as data', r.ok && r.kind === 'data' && r.text.includes('1,2,3'), JSON.stringify(r))
}

section('PDF (hand-built, real text layer)')
{
  await fsp.writeFile(p('doc.pdf'), makeMinimalPdf('Luna reads PDFs cleanly'))
  const r = await extractDocument(p('doc.pdf'))
  ok('.pdf text layer is extracted', r.ok && r.kind === 'pdf' && /Luna reads PDFs/.test(r.text), JSON.stringify(r))
  ok('.pdf reports a page count', r.ok && !!r.meta && (r.meta as any).pages === 1, JSON.stringify(r.meta))
}

section('Word .docx (real OOXML)')
{
  await fsp.writeFile(p('memo.docx'), await makeDocx(['First heading paragraph.', 'A second body paragraph with detail.']))
  const r = await extractDocument(p('memo.docx'))
  ok('.docx paragraphs are extracted', r.ok && r.kind === 'docx' && /First heading/.test(r.text) && /second body/.test(r.text), JSON.stringify(r))
}

section('Excel .xlsx (real workbook)')
{
  await makeXlsx(p('sheet.xlsx'))
  const r = await extractDocument(p('sheet.xlsx'))
  ok('.xlsx cells flatten to CSV text', r.ok && r.kind === 'xlsx' && /name,score/.test(r.text) && /Ada,91/.test(r.text), JSON.stringify(r))
  ok('.xlsx reports sheet count', r.ok && !!r.meta && (r.meta as any).sheets === 1, JSON.stringify(r.meta))
}

section('Binary detection & graceful degradation')
{
  await fsp.writeFile(p('blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x00]))
  const r = await extractDocument(p('blob.bin'))
  ok('a binary blob is refused, not dumped', !r.ok && r.kind === 'binary', JSON.stringify(r))
}
{
  // a .png-style file (unknown-to-text) with NUL bytes
  await fsp.writeFile(p('image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]))
  const r = await extractDocument(p('image.png'))
  ok('an unreadable binary is reported as binary', !r.ok && r.kind === 'binary', JSON.stringify(r))
}
{
  // corrupt docx (not a real zip) must degrade, never throw
  await fsp.writeFile(p('broken.docx'), 'this is not a docx at all')
  const r = await extractDocument(p('broken.docx'))
  ok('a corrupt .docx degrades to a friendly error', !r.ok && !!r.error, JSON.stringify(r))
}
{
  // corrupt pdf must degrade
  await fsp.writeFile(p('broken.pdf'), 'not really a pdf')
  const r = await extractDocument(p('broken.pdf'))
  ok('a corrupt .pdf degrades to a friendly error', !r.ok && !!r.error, JSON.stringify(r))
}

section('Caps')
{
  await fsp.writeFile(p('huge.txt'), 'x'.repeat(500_000))
  const r = await extractDocument(p('huge.txt'))
  ok('a huge text file is truncated (not unbounded)', r.ok && r.truncated === true && r.text.length < 450_000, `len=${r.ok ? r.text.length : 0}`)
}
{
  const missing = await extractDocument(p('does-not-exist.txt'))
  ok('a missing file returns a clean error', !missing.ok && !!missing.error, JSON.stringify(missing))
}

console.log(`\n\x1b[1mResults: \x1b[32m${pass} passed\x1b[0m, ${fail ? `\x1b[31m${fail} failed\x1b[0m` : '0 failed'}`)
try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
