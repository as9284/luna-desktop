/**
 * Integration harness for Luna's file/code tool layer.
 * Run: npx tsx scripts/test-tools.mts
 *
 * Wires the REAL grant store, file ops, extraction, and sandbox to the createFileTools()
 * executor with a controllable fake permission prompt, then drives every tool through the
 * happy path, the refusal path, and the decline path — proving guard → tiered approval → op
 * compose correctly (and that declines never touch disk).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createGrantStore } from '../electron/luna/fs/grants'
import { createFsOps } from '../electron/luna/fs/ops'
import { createActivityLog } from '../electron/luna/fs/log'
import { createFileTools, type PermissionRequest } from '../electron/luna/tools'
import { extractDocument } from '../electron/luna/extract'
import { runSandboxed } from '../electron/luna/sandbox'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`) }
}
const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`)
const ctx = { status: () => {}, signal: new AbortController().signal }

// ---- throwaway fs ---------------------------------------------------------
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-tools-'))
const home = path.join(ROOT, 'home')
const userData = path.join(ROOT, 'userData')
const documents = path.join(home, 'Documents')
const outside = path.join(home, 'outside')
for (const d of [home, userData, documents, outside]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope')

const store = createGrantStore({ home, userData, documents })
const workspace = store.ensureWorkspace()
fs.writeFileSync(path.join(workspace, 'readme.md'), '# Hello Luna\nThis is a file.')
const trashDir = path.join(ROOT, 'trash')
fs.mkdirSync(trashDir)
const activity = createActivityLog({ file: path.join(userData, 'activity.json') })
const ops = createFsOps({
  getGuard: () => store.guardConfig(),
  trash: async (p) => fs.renameSync(p, path.join(trashDir, path.basename(p) + Date.now())),
  backupDir: path.join(userData, 'backups'),
  log: (e) => activity.push(e),
})

// controllable permission prompt: capture every request, answer with `decision`
let decision = true
const asked: PermissionRequest[] = []
let folderAccessResult: { granted: boolean; path?: string; reason?: string } = { granted: true, path: outside }
const makeTools = (approvedOnce = new Set<string>()) =>
  createFileTools({
    guard: () => store.guardConfig(),
    ops,
    activity,
    extract: extractDocument,
    analyzeImage: async () => ({ ok: true, text: 'a description' }),
    runCode: (code) => runSandboxed(code, {}),
    renderPdf: async (html) => new TextEncoder().encode('%PDF-1.7 fake ' + html.length), // stub: no real Electron here
    requestPermission: async (req) => { asked.push(req); return decision },
    requestFolderAccess: async () => folderAccessResult,
    workspaceInfo: () => ({ workspace, grants: store.list().map((g) => ({ id: g.id, path: g.path })) }),
    approvedOnce,
  })

// ---- read: silent, guarded -----------------------------------------------
section('read_file — silent, guarded')
{
  asked.length = 0
  const out = JSON.parse(await makeTools().run('read_file', JSON.stringify({ path: path.join(workspace, 'readme.md') }), ctx))
  ok('reads a workspace file', out.content?.includes('Hello Luna'), JSON.stringify(out))
  ok('a read never prompts for permission', asked.length === 0)
}
{
  const out = JSON.parse(await makeTools().run('read_file', JSON.stringify({ path: path.join(outside, 'secret.txt') }), ctx))
  ok('reading outside every root is refused', !!out.error, JSON.stringify(out))
}

// ---- write: ask-once, then remembered ------------------------------------
section('write_file — ask-once, remembered, guarded')
{
  asked.length = 0
  decision = true
  const shared = new Set<string>()
  const tools = makeTools(shared)
  const t1 = path.join(workspace, 'out1.txt')
  const r1 = JSON.parse(await tools.run('write_file', JSON.stringify({ path: t1, content: 'one' }), ctx))
  ok('first create prompts once', asked.length === 1 && asked[0].action === 'create', JSON.stringify(asked))
  ok('the file is written after approval', r1.ok && fs.readFileSync(t1, 'utf8') === 'one')

  const t2 = path.join(workspace, 'out2.txt')
  const r2 = JSON.parse(await tools.run('write_file', JSON.stringify({ path: t2, content: 'two' }), ctx))
  ok('a second write does NOT prompt again (ask-once remembered)', asked.length === 1, `asked=${asked.length}`)
  ok('the second file is written', r2.ok && fs.readFileSync(t2, 'utf8') === 'two')
}
{
  // overwrite makes a backup
  asked.length = 0
  const t = path.join(workspace, 'over.txt')
  fs.writeFileSync(t, 'old')
  const tools = makeTools(new Set(['write'])) // pretend already approved this session
  const r = JSON.parse(await tools.run('write_file', JSON.stringify({ path: t, content: 'new' }), ctx))
  ok('overwrite reports action=overwrite with a backup', r.ok && r.action === 'overwrite' && !!r.backup, JSON.stringify(r))
  ok('the backup holds the old content', fs.readFileSync(r.backup, 'utf8') === 'old')
  ok('no prompt when write already remembered', asked.length === 0)
}
{
  // outside a root: refused BEFORE any prompt
  asked.length = 0
  const out = JSON.parse(await makeTools().run('write_file', JSON.stringify({ path: path.join(outside, 'evil.txt'), content: 'x' }), ctx))
  ok('writing outside a root is refused', !!out.error)
  ok('…and the user is never prompted for it', asked.length === 0)
  ok('…and nothing is written', !fs.existsSync(path.join(outside, 'evil.txt')))
}
{
  // decline → nothing written
  asked.length = 0
  decision = false
  const t = path.join(workspace, 'declined.txt')
  const out = JSON.parse(await makeTools().run('write_file', JSON.stringify({ path: t, content: 'x' }), ctx))
  ok('a declined write returns an error', !!out.error && /declined/i.test(out.error))
  ok('a declined write creates no file', !fs.existsSync(t))
  decision = true
}

// ---- export_pdf: renders + writes bytes, reuses write approval ------------
section('export_pdf — render → guarded binary write')
{
  asked.length = 0
  decision = true
  const t = path.join(workspace, 'doc.pdf')
  const out = JSON.parse(await makeTools().run('export_pdf', JSON.stringify({ path: t, html: '<h1>Hi</h1>' }), ctx))
  ok('export prompts once (create tier) then writes the pdf', asked.length === 1 && out.ok && fs.existsSync(t), JSON.stringify(out))
  ok('the written file holds the rendered bytes', fs.readFileSync(t, 'utf8').startsWith('%PDF'))
}
{
  asked.length = 0
  const out = JSON.parse(await makeTools().run('export_pdf', JSON.stringify({ path: path.join(outside, 'evil.pdf'), html: '<p>x</p>' }), ctx))
  ok('exporting outside a root is refused before prompting', !!out.error && asked.length === 0)
}
{
  asked.length = 0
  decision = false
  const t = path.join(workspace, 'declined.pdf')
  const out = JSON.parse(await makeTools().run('export_pdf', JSON.stringify({ path: t, html: '<p>x</p>' }), ctx))
  ok('a declined export writes nothing', !!out.error && !fs.existsSync(t))
  decision = true
}
{
  const out = JSON.parse(await makeTools().run('export_pdf', JSON.stringify({ path: path.join(workspace, 'nohtml.pdf') }), ctx))
  ok('export_pdf requires html', !!out.error && /html/i.test(out.error))
}

// ---- delete: always confirm ----------------------------------------------
section('delete_file — always confirm, recycle bin')
{
  asked.length = 0
  decision = true
  const t = path.join(workspace, 'todelete.txt')
  fs.writeFileSync(t, 'bye')
  const out = JSON.parse(await makeTools().run('delete_file', JSON.stringify({ path: t }), ctx))
  ok('delete prompts (confirm tier)', asked.length === 1 && asked[0].action === 'delete')
  ok('approved delete removes the original', out.ok && !fs.existsSync(t))
}
{
  asked.length = 0
  decision = false
  const t = path.join(workspace, 'keep.txt')
  fs.writeFileSync(t, 'stay')
  const out = JSON.parse(await makeTools().run('delete_file', JSON.stringify({ path: t }), ctx))
  ok('a declined delete keeps the file', !!out.error && fs.existsSync(t))
  decision = true
}
{
  asked.length = 0
  const out = JSON.parse(await makeTools().run('delete_file', JSON.stringify({ path: path.join(outside, 'secret.txt') }), ctx))
  ok('deleting outside a root is refused before prompting', !!out.error && asked.length === 0)
}

// ---- run_code: always confirm, sandboxed ---------------------------------
section('run_code — always confirm, sandboxed')
{
  asked.length = 0
  decision = true
  const out = JSON.parse(await makeTools().run('run_code', JSON.stringify({ code: '2 ** 10' }), ctx))
  ok('run_code prompts (confirm tier)', asked.length === 1 && asked[0].action === 'run_code')
  ok('approved code runs in the sandbox and returns a result', out.ok && out.result === '1024', JSON.stringify(out))
}
{
  asked.length = 0
  decision = false
  const out = JSON.parse(await makeTools().run('run_code', JSON.stringify({ code: 'while(true){}' }), ctx))
  ok('a declined run does not execute', !!out.error && /declined/i.test(out.error))
  decision = true
}

// ---- folder access + workspace info --------------------------------------
section('request_folder_access + workspace_info')
{
  folderAccessResult = { granted: true, path: outside }
  const out = JSON.parse(await makeTools().run('request_folder_access', JSON.stringify({ reason: 'need files' }), ctx))
  ok('folder access routes through the picker dep', out.granted === true && out.path === outside, JSON.stringify(out))
}
{
  const out = JSON.parse(await makeTools().run('workspace_info', '{}', ctx))
  ok('workspace_info returns the workspace path', typeof out.workspace === 'string' && out.workspace.includes('Luna'))
}
{
  const out = JSON.parse(await makeTools().run('bogus_tool', '{}', ctx))
  ok('an unknown tool is rejected cleanly', !!out.error)
  const bad = JSON.parse(await makeTools().run('read_file', 'not json', ctx))
  ok('malformed arguments are handled', !!bad.error)
}

console.log(`\n\x1b[1mResults: \x1b[32m${pass} passed\x1b[0m, ${fail ? `\x1b[31m${fail} failed\x1b[0m` : '0 failed'}`)
try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
