/**
 * Backend harness for the activity-feedback core (electron/luna/activity.ts): the tool → step
 * mapping the renderer animates, and the result → success/failure classification.
 * Run: npx tsx scripts/test-activity.mts
 */
import { stepFor, outcomeOf } from '../electron/luna/activity'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`) }
}
const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`)

section('stepFor — kind + label + target')
{
  const search = stepFor('web_search', { query: 'europe heatwave 2025' })
  ok('web_search → search kind', search.kind === 'search')
  ok('web_search labels the action', search.label === 'Searching the web')
  ok('web_search quotes the query as target', search.target === '“europe heatwave 2025”', search.target)

  const read = stepFor('read_file', { path: 'C:\\Users\\A\\Documents\\notes.pdf' })
  ok('read_file → read kind', read.kind === 'read')
  ok('read_file target is the basename only', read.target === 'notes.pdf', read.target)

  const write = stepFor('write_file', { path: '/tmp/reports/brief.html' })
  ok('write_file → write kind', write.kind === 'write')
  ok('write_file basename from a posix path', write.target === 'brief.html', write.target)

  ok('export_pdf → pdf kind', stepFor('export_pdf', { path: 'a/b/out.pdf' }).kind === 'pdf')
  ok('run_code → code kind, no target', (() => { const s = stepFor('run_code', {}); return s.kind === 'code' && s.target === undefined })())
  ok('delete_file → delete kind', stepFor('delete_file', { path: 'x/old.txt' }).kind === 'delete')
  ok('analyze_image → image kind', stepFor('analyze_image', { path: 'p/pic.png' }).kind === 'image')
  ok('list_dir → browse kind', stepFor('list_dir', { path: 'p/folder' }).kind === 'browse')

  const saveUrl = stepFor('atlas_save_url', { url: 'https://www.example.com/a/b?x=1' })
  ok('atlas_save_url → save kind', saveUrl.kind === 'save')
  ok('atlas_save_url target is the host', saveUrl.target === 'www.example.com', saveUrl.target)

  ok('atlas_search → search kind', stepFor('atlas_search', { query: 'x' }).kind === 'search')
  ok('atlas_list_highlights → highlight kind', stepFor('atlas_list_highlights', {}).kind === 'highlight')
  ok('orbit_add_task → task kind', stepFor('orbit_add_task', { text: 'buy milk' }).kind === 'task')
  ok('orbit_add_note → note kind', stepFor('orbit_add_note', { title: 'Ideas' }).kind === 'note')
  ok('orbit_add_project → project kind', stepFor('orbit_add_project', { name: 'Launch' }).kind === 'project')
  ok('use_skill → skill kind', stepFor('use_skill', { name: 'research' }).kind === 'skill')
  ok('remember → memory kind', stepFor('remember', { note: 'prefers dark mode' }).kind === 'memory')

  const long = stepFor('web_search', { query: 'x'.repeat(200) })
  ok('a very long query target is clipped', (long.target?.length ?? 0) <= 60, String(long.target?.length))

  const unknown = stepFor('totally_made_up', {})
  ok('an unknown tool falls back to a readable label', unknown.label === 'totally made up' && unknown.kind === 'read', unknown.label)

  const noArgs = stepFor('write_file', {})
  ok('missing path → no target, no crash', noArgs.target === undefined && noArgs.kind === 'write')
}

section('outcomeOf — success vs failure')
{
  ok('web_search markdown result is a success', outcomeOf('web_search', '## Results\n- a\n- b').ok)
  ok('web_search "Search failed:" is an error', outcomeOf('web_search', 'Search failed: network down').ok === false)
  ok('web_search failure carries the reason', outcomeOf('web_search', 'Search failed: network down').detail?.includes('network down') === true)
  ok('web_search "No query provided." is an error', outcomeOf('web_search', 'No query provided.').ok === false)

  ok('a JSON result with no error is a success', outcomeOf('write_file', '{"ok":true,"path":"a.txt"}').ok)
  const err = outcomeOf('write_file', '{"error":"folder not granted"}')
  ok('a JSON result with error is a failure', err.ok === false)
  ok('the failure detail is the error message', err.detail === 'folder not granted', err.detail)
  ok('ok:false is treated as a failure', outcomeOf('atlas_save_url', '{"ok":false,"reason":"already saved"}').ok === false)
  ok('a plain-text non-web result is assumed success', outcomeOf('use_skill', 'not json here').ok)
}

console.log(`\n\x1b[1mResults: \x1b[32m${pass} passed\x1b[0m, ${fail ? `\x1b[31m${fail} failed\x1b[0m` : '0 failed'}`)
process.exit(fail ? 1 : 0)
