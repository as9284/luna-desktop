/**
 * Backend reliability harness for the Luna code sandbox.
 * Run: npx tsx scripts/test-sandbox.mts
 *
 * Proves the "no I/O" guarantee: correct results + captured logs for legit snippets, and
 * hard refusal / containment for filesystem, network, process-escape, dynamic-import, and
 * runaway-loop attempts.
 */
import { runSandboxed } from '../electron/luna/sandbox'

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

section('Correctness — it actually runs code')
{
  const r = await runSandboxed('1 + 2 * 3')
  ok('returns the completion value of an expression', r.ok && r.result === '7', JSON.stringify(r))
}
{
  const r = await runSandboxed('const xs = [3,1,2]; xs.sort((a,b)=>a-b); xs')
  ok('array/statement snippet returns last expression', r.ok && r.result === '[1,2,3]', JSON.stringify(r))
}
{
  const r = await runSandboxed('console.log("hello"); console.log(40 + 2); 99')
  ok('captures console.log output in order', r.ok && r.logs.join('|') === 'hello|42', JSON.stringify(r.logs))
  ok('…and still returns the completion value', r.ok && r.result === '99')
}
{
  const r = await runSandboxed('JSON.stringify({a: Math.max(1,2,3), b: "x".repeat(3)})')
  ok('JSON + Math + String built-ins are available', r.ok && r.result === '{"a":3,"b":"xxx"}', JSON.stringify(r))
}
{
  const r = await runSandboxed('Promise.resolve(21 * 2)')
  ok('a returned promise is awaited and unwrapped', r.ok && r.result === '42', JSON.stringify(r))
}
{
  // realistic data-transform: parse CSV-ish text and sum a column
  const code = `
    const rows = "a,1\\nb,2\\nc,3".split("\\n").map(l => l.split(","))
    const total = rows.reduce((s, [,n]) => s + Number(n), 0)
    "total=" + total
  `
  const r = await runSandboxed(code)
  ok('data-transform snippet computes correctly', r.ok && r.result === 'total=6', JSON.stringify(r))
}

section('Isolation — no filesystem')
{
  const r = await runSandboxed('require("node:fs").readFileSync("/etc/passwd","utf8")')
  ok('require is not defined (no fs access)', !r.ok && /require is not defined/.test(r.error || ''), JSON.stringify(r))
}
{
  const r = await runSandboxed('import("node:fs").then(m => m.readdirSync("."))')
  ok('dynamic import() is blocked', !r.ok, JSON.stringify(r))
}

section('Isolation — no network')
{
  const r = await runSandboxed('typeof fetch')
  ok('fetch is undefined in the sandbox', r.ok && r.result === 'undefined', JSON.stringify(r))
}
{
  const r = await runSandboxed('fetch("https://example.com")')
  ok('calling fetch throws (not defined)', !r.ok && /fetch is not defined/.test(r.error || ''), JSON.stringify(r))
}
{
  const r = await runSandboxed('typeof XMLHttpRequest + "," + typeof WebSocket')
  ok('no XMLHttpRequest / WebSocket either', r.ok && r.result === 'undefined,undefined', JSON.stringify(r))
}

section('Isolation — no process / no host escape')
{
  const r = await runSandboxed('typeof process')
  ok('process is undefined', r.ok && r.result === 'undefined', JSON.stringify(r))
}
{
  // the classic vm escape: reach the Function constructor via the global's prototype chain.
  // With a null-proto context global this now throws outright — and must never see process.
  const r = await runSandboxed('this.constructor.constructor("return typeof process")()')
  ok('global-prototype escape is blocked (never reaches host process)', r.result !== 'object', JSON.stringify(r))
}
{
  // the working constructor chain (via a literal) stays inside the context: no host process
  const r = await runSandboxed('[].constructor.constructor("return typeof process")()')
  ok('in-context Function constructor sees no process', r.ok && r.result === 'undefined', JSON.stringify(r))
}
{
  const r = await runSandboxed('typeof Buffer + "," + typeof global + "," + typeof globalThis.require')
  ok('no Buffer / global / require leaked in', r.ok && /undefined/.test(r.result || ''), JSON.stringify(r))
}

section('Safety — runaway code is contained')
{
  const t0 = Date.now()
  const r = await runSandboxed('while(true){}', { timeoutMs: 400 })
  const wall = Date.now() - t0
  ok('an infinite sync loop is killed', !r.ok && /timed out/i.test(r.error || ''), JSON.stringify(r))
  ok('…and killed promptly (well under 3s)', wall < 3000, `took ${wall}ms`)
}
{
  const t0 = Date.now()
  const r = await runSandboxed('new Promise(() => {})', { timeoutMs: 400 }) // never settles
  const wall = Date.now() - t0
  ok('a never-settling promise hits the wall-clock backstop', !r.ok && /timed out/i.test(r.error || ''), JSON.stringify(r))
  ok('…backstop fires within timeout + margin', wall < 2000, `took ${wall}ms`)
}

section('Robustness — bad input is handled, not crashed')
{
  const r = await runSandboxed('this is not valid javascript {{{')
  ok('a syntax error is reported cleanly', !r.ok && !!r.error, JSON.stringify(r))
}
{
  const r = await runSandboxed('throw new Error("boom")')
  ok('a thrown error is caught and surfaced', !r.ok && /boom/.test(r.error || ''), JSON.stringify(r))
}
{
  const r = await runSandboxed('console.log("before"); throw new Error("x")')
  ok('logs before a throw are still returned', !r.ok && r.logs.includes('before'), JSON.stringify(r))
}

console.log(`\n\x1b[1mResults: \x1b[32m${pass} passed\x1b[0m, ${fail ? `\x1b[31m${fail} failed\x1b[0m` : '0 failed'}`)
process.exit(fail ? 1 : 0)
