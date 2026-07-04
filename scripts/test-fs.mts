/**
 * Backend reliability harness for the Luna safeguard chassis.
 * Run: npx tsx scripts/test-fs.mts
 *
 * Exercises the path guard (containment, traversal, symlink escape, denylist, secret
 * filenames), the grant registry, the tiered permission policy, the file ops (create /
 * overwrite-with-backup / recycle-bin delete), and the activity log — all under plain Node,
 * with no Electron, against a throwaway temp filesystem.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { guardPath, isInside, realOf, normalizeRoots } from '../electron/luna/fs/paths'
import { buildDenylist } from '../electron/luna/fs/denylist'
import { classify, needsApproval } from '../electron/luna/fs/policy'
import { createGrantStore } from '../electron/luna/fs/grants'
import { createFsOps } from '../electron/luna/fs/ops'
import { createActivityLog } from '../electron/luna/fs/log'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) {
    pass++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    fail++
    console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`)
  }
}
const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`)

// ---- throwaway filesystem -------------------------------------------------
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-fs-test-'))
const home = path.join(ROOT, 'home')
const userData = path.join(ROOT, 'userData')
const documents = path.join(home, 'Documents')
const outside = path.join(home, 'outside')
const granted = path.join(home, 'granted')
const ssh = path.join(home, '.ssh')
for (const d of [home, userData, documents, outside, granted, ssh]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET')
fs.writeFileSync(path.join(ssh, 'id_rsa'), 'PRIVATE KEY')
fs.writeFileSync(path.join(granted, 'notes.txt'), 'hello from granted')

const dirs = { home, userData, documents }

// ---- 1. grant store + workspace ------------------------------------------
section('Grant registry + workspace')
const grants = createGrantStore(dirs)
const workspace = grants.ensureWorkspace()
ok('workspace folder created under Documents/Luna', fs.existsSync(workspace) && workspace.includes('Luna'))
ok('roots start as [workspace] only', grants.roots().length === 1)

const addRes = grants.add(granted)
ok('granting a normal folder succeeds', addRes.ok)
ok('roots now include the granted folder', grants.roots().length === 2)
const dupe = grants.add(granted)
ok('granting the same folder again dedupes', dupe.ok && grants.list().length === 1)
const denyAdd = grants.add(userData) // userData is denylisted
ok('cannot grant a folder inside the denylist', !denyAdd.ok)
const badAdd = grants.add(path.join(ROOT, 'nope'))
ok('cannot grant a non-existent folder', !badAdd.ok)

// ---- 2. path guard --------------------------------------------------------
section('Path guard — containment & escapes')
const cfg = grants.guardConfig()
ok('allows a file inside the workspace', guardPath(path.join(workspace, 'a.txt'), cfg).ok)
ok('allows a file inside a granted folder', guardPath(path.join(granted, 'notes.txt'), cfg).ok)
ok('allows a not-yet-existing file inside a root (create case)', guardPath(path.join(granted, 'new/deep/file.txt'), cfg).ok)
ok('refuses a path outside every root', !guardPath(path.join(outside, 'secret.txt'), cfg).ok)
ok('refuses `..` traversal escaping a root', !guardPath(path.join(granted, '..', 'outside', 'secret.txt'), cfg).ok)
ok('refuses an absolute system path', !guardPath(process.platform === 'win32' ? 'C:\\Windows\\system32\\x' : '/etc/passwd', cfg).ok)
ok('refuses the denylisted userData dir even if asked directly', !guardPath(path.join(userData, 'luna-grants.json'), cfg).ok)

section('Path guard — relative paths resolve to the workspace')
{
  const bare = guardPath('films-2025.md', cfg)
  ok('a bare filename resolves inside the workspace, not the cwd', bare.ok && isInside(workspace, bare.real), JSON.stringify(bare))
  const nested = guardPath('reports/q3.md', cfg)
  ok('a relative subpath resolves inside the workspace', nested.ok && isInside(workspace, nested.real))
  ok('a relative `..` escape out of the workspace is still refused', !guardPath('../escape/secret.txt', cfg).ok)
}

section('Path guard — secret filenames')
ok('refuses id_rsa by name (even inside a root)', !guardPath(path.join(granted, 'id_rsa'), cfg).ok)
ok('refuses a .env file', !guardPath(path.join(granted, '.env'), cfg).ok)
ok('refuses a *.pem file', !guardPath(path.join(granted, 'server.pem'), cfg).ok)
ok('allows a normal .txt file', guardPath(path.join(granted, 'ok.txt'), cfg).ok)

section('Path guard — symlink escape')
const link = path.join(granted, 'escape-link')
let symlinkMade = false
try {
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  symlinkMade = true
} catch (e) {
  console.log(`  \x1b[33m! symlink test skipped (needs privilege): ${(e as Error).message}\x1b[0m`)
}
if (symlinkMade) {
  const viaLink = guardPath(path.join(link, 'secret.txt'), cfg)
  ok('a symlink inside a root pointing outside is caught', !viaLink.ok, JSON.stringify(viaLink))
}

section('isInside / realOf units')
ok('isInside: child under parent', isInside(granted, path.join(granted, 'x/y')))
ok('isInside: sibling is not inside', !isInside(granted, outside))
ok('isInside: parent is not inside child', !isInside(path.join(granted, 'x'), granted))
ok('isInside: prefix-but-not-child is rejected', !isInside(path.join(ROOT, 'gr'), path.join(ROOT, 'granted')))
ok('normalizeRoots drops nothing valid', normalizeRoots([granted, workspace]).length === 2)

// ---- 3. tiered permission policy -----------------------------------------
section('Tiered permission policy')
ok('reads are silent', classify('read') === 'silent' && classify('list') === 'silent')
ok('create/overwrite are ask-once', classify('create') === 'ask-once' && classify('overwrite') === 'ask-once')
ok('delete + run_code always confirm', classify('delete') === 'confirm' && classify('run_code') === 'confirm')
const approved = new Set<string>()
ok('a read never needs approval', !needsApproval('read', 'read:x', approved))
ok('first create needs approval', needsApproval('create', 'create:a.txt', approved))
approved.add('create:a.txt')
ok('remembered create is now silent', !needsApproval('create', 'create:a.txt', approved))
ok('delete needs approval every time even if "remembered"', needsApproval('delete', 'delete:a.txt', new Set(['delete:a.txt'])))

// ---- 4. file ops: create / overwrite+backup / recycle delete -------------
section('File ops — create, overwrite (backup), recycle-bin delete')
const trashDir = path.join(ROOT, 'trash')
fs.mkdirSync(trashDir, { recursive: true })
const trashed: string[] = []
const backupDir = path.join(userData, 'luna-backups')
const activity = createActivityLog({ file: path.join(userData, 'luna-activity.json') })
const ops = createFsOps({
  getGuard: () => grants.guardConfig(),
  trash: async (p) => {
    // simulate the Recycle Bin: move, don't unlink
    const dest = path.join(trashDir, path.basename(p) + '-' + Date.now())
    fs.renameSync(p, dest)
    trashed.push(dest)
  },
  backupDir,
  log: (e) => activity.push(e),
})

const target = path.join(workspace, 'report.md')
const w1 = await ops.writeFile(target, '# v1\n')
ok('write to a new file reports action=create', w1.ok && w1.action === 'create')
ok('the file now exists with v1 content', fs.readFileSync(target, 'utf8') === '# v1\n')
ok('writeKind sees an existing file as overwrite', ops.writeKind(target) === 'overwrite')

const w2 = await ops.writeFile(target, '# v2 changed\n')
ok('overwriting reports action=overwrite', w2.ok && w2.action === 'overwrite')
ok('overwrite produced a backup file', !!(w2.ok && w2.backup && fs.existsSync(w2.backup)))
ok('the backup holds the OLD (v1) content', !!(w2.ok && w2.backup && fs.readFileSync(w2.backup, 'utf8') === '# v1\n'))
ok('the live file holds the NEW (v2) content', fs.readFileSync(target, 'utf8') === '# v2 changed\n')

const r1 = await ops.readFile(target)
ok('read returns the current content', r1.ok && r1.text === '# v2 changed\n')

const list = await ops.listDir(workspace)
ok('list_dir returns the workspace entries', list.ok && list.entries.some((e) => e.name === 'report.md'))

const d1 = await ops.deleteFile(target)
ok('delete succeeds', d1.ok)
ok('the file is GONE from its original location', !fs.existsSync(target))
ok('…but was moved to the "Recycle Bin", not destroyed', trashed.length === 1 && fs.existsSync(trashed[0]))

section('File ops — guard is enforced on every op')
const badRead = await ops.readFile(path.join(outside, 'secret.txt'))
ok('reading outside a root is refused', !badRead.ok)
const badWrite = await ops.writeFile(path.join(outside, 'evil.txt'), 'x')
ok('writing outside a root is refused', !badWrite.ok && !fs.existsSync(path.join(outside, 'evil.txt')))
const badDelete = await ops.deleteFile(path.join(ssh, 'id_rsa'))
ok('deleting a denylisted secret is refused', !badDelete.ok && fs.existsSync(path.join(ssh, 'id_rsa')))

// ---- 5. activity log ------------------------------------------------------
section('Activity log')
const recent = activity.recent()
ok('every op was logged', recent.length >= 6)
ok('a refused op is logged as ok=false', recent.some((e) => !e.ok))
ok('the delete was logged with detail', recent.some((e) => e.action === 'delete' && e.ok && /Recycle/.test(e.detail || '')))
const log2 = createActivityLog({ file: path.join(userData, 'luna-activity.json') })
ok('the log persists across reloads', log2.recent().length >= 6)

// ---- 6. denylist shape sanity --------------------------------------------
section('Denylist construction')
const dl = buildDenylist({ home, userData })
ok('denylist includes app userData (its own secrets)', dl.some((d) => isInside(d, path.join(userData, 'x'))))
ok('denylist includes ~/.ssh', dl.some((d) => isInside(d, path.join(ssh, 'id_rsa'))))

// ---- summary --------------------------------------------------------------
console.log(`\n\x1b[1mResults: \x1b[32m${pass} passed\x1b[0m, ${fail ? `\x1b[31m${fail} failed\x1b[0m` : '0 failed'}`)
try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
