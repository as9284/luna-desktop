import { Worker } from 'node:worker_threads'

/**
 * Sandboxed code execution — the "no I/O" dial the user chose.
 *
 * User code runs inside a fresh `vm` context (ECMAScript built-ins only: Object, Array,
 * JSON, Math, Date, String… — but NO require, process, fetch, Buffer, setTimeout, or
 * dynamic import) on a `worker_threads` worker. So the code:
 *   - cannot touch the filesystem (no require/fs, no import())
 *   - cannot reach the network (no fetch/XMLHttpRequest/WebSocket in the context)
 *   - cannot escape to the host process (the context's own Function/constructor chain
 *     stays inside the context — nothing from the host is passed in but a log sink)
 *   - cannot hang the app: the vm `timeout` interrupts synchronous loops, and a wall-clock
 *     backstop terminates the worker for anything async that never settles.
 *
 * The completion value of the snippet (like a REPL's last expression) is returned as
 * `result`, alongside anything it console.log'd. Fully exercised in scripts/test-sandbox.mts.
 */

export interface SandboxResult {
  ok: boolean
  /** stringified completion value of the snippet, when it ran */
  result?: string
  /** captured console output, in order */
  logs: string[]
  /** wall-clock duration */
  ms: number
  error?: string
}

// The worker body. Runs the snippet in a sealed vm context and reports back exactly once.
//
// Two escapes this closes (see the test harness):
//  - the context global is a *null-prototype* object, so `this.constructor` can't walk back
//    to the host realm's Function/process (the classic vm escape).
//  - `console` is built INSIDE the context from context-native functions, so user code can't
//    reach a host function's constructor either. Logs are read back out as a plain array.
//  - an in-worker timer keeps the thread alive to report a timeout for async code that never
//    settles (a pending promise doesn't, by itself, keep Node's event loop alive).
const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads')
const vm = require('node:vm')
const start = Date.now()
let settled = false
let killer = null

function hostFmt(v) {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'string') return v
  if (typeof v === 'bigint') return v.toString() + 'n'
  if (typeof v === 'function') return '[Function' + (v.name ? ': ' + v.name : '') + ']'
  try { const s = JSON.stringify(v); return s === undefined ? String(v) : s } catch (e) { return String(v) }
}

// null-proto global: nothing on it chains back to the host realm
const ctx = vm.createContext(Object.create(null))
// context-native console + log buffer (no host references handed to user code)
vm.runInContext(
  'globalThis.__logs=[];var __cap=200;' +
  'var __f=function(v){' +
    'if(v===undefined)return "undefined";if(v===null)return "null";' +
    'if(typeof v==="string")return v;if(typeof v==="bigint")return v.toString()+"n";' +
    'if(typeof v==="function")return "[Function"+(v.name?": "+v.name:"")+"]";' +
    'try{var s=JSON.stringify(v);return s===undefined?String(v):s}catch(e){return String(v)}};' +
  'var __m=function(){return function(){if(__logs.length<__cap){' +
    '__logs.push(Array.prototype.slice.call(arguments).map(__f).join(" "))}}};' +
  'globalThis.console={log:__m(),info:__m(),warn:__m(),error:__m(),debug:__m()};',
  ctx,
)
function readLogs() {
  try { const a = vm.runInContext('__logs', ctx); return Array.isArray(a) ? a.slice() : [] } catch (e) { return [] }
}
function send(m) {
  if (settled) return
  settled = true
  if (killer) clearTimeout(killer)
  parentPort.postMessage(Object.assign({ logs: readLogs(), ms: Date.now() - start }, m))
}
// keeps the worker alive so async hangs report a timeout instead of a silent early exit
killer = setTimeout(function () { send({ ok: false, error: 'Timed out after ' + workerData.timeoutMs + 'ms.' }) }, workerData.timeoutMs)

try {
  const value = vm.runInContext(workerData.code, ctx, { timeout: workerData.timeoutMs, filename: 'luna-snippet.js' })
  Promise.resolve(value).then(
    function (r) { send({ ok: true, result: hostFmt(r) }) },
    function (e) { send({ ok: false, error: e && e.message ? String(e.message) : String(e) }) },
  )
} catch (e) {
  send({ ok: false, error: e && e.message ? String(e.message) : String(e) })
}
`

export function runSandboxed(code: string, opts: { timeoutMs?: number } = {}): Promise<SandboxResult> {
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 3000, 100), 15000)
  return new Promise((resolve) => {
    let done = false
    const worker = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { code, timeoutMs },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
    })
    const finish = (r: SandboxResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      void worker.terminate()
      resolve(r)
    }
    // backstop for async code that never settles (vm timeout only catches sync loops)
    const timer = setTimeout(
      () => finish({ ok: false, error: `Timed out after ${timeoutMs}ms.`, logs: [], ms: timeoutMs }),
      timeoutMs + 500,
    )
    worker.on('message', (m: SandboxResult) => finish(m))
    worker.on('error', (e) => finish({ ok: false, error: e.message, logs: [], ms: 0 }))
    worker.on('exit', (code) => {
      if (!done) finish({ ok: false, error: `Sandbox exited unexpectedly (code ${code}).`, logs: [], ms: 0 })
    })
  })
}
