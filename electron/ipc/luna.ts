import { type IpcMainEvent, ipcMain } from 'electron'
import { runWebSearch } from '../search'
import { runAtlasTool, saveResearchDoc } from '../atlas'
import { LUNA_FS_TOOLS, LUNA_FS_TOOL_NAMES, runLunaFsTool, stepFor, outcomeOf, type LunaStep } from '../luna'
import { SOUL_TOOLS, SOUL_TOOL_NAMES, runSoulTool, composeIdentity } from '../soul'
import { streamChat, hasKey, isNoKey, textCallAssistantContent, textCallObservationContent, type ChatMsg } from '../llm'

/** Tool-call round trips before forcing a final answer without tools — guards against loops.
 *  A research → save → build → export chain legitimately needs several, so keep real headroom. */
const MAX_ROUNDS = 8

const baseName = (p: string): string => p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p

interface ChatRequest {
  id: string
  messages: { role: string; content: string }[]
  temperature?: number
  /** false disables tool use entirely (e.g. the writing assistant, which must only rewrite) */
  tools?: boolean
  /** archive pages read during web search to the Atlas research shelf (opt-in setting) */
  research?: boolean
  /** prepend Luna's composed identity (soul + rules + skills + memory) as the system prompt */
  identity?: boolean
}

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
})

const TOOLS = [
  fn(
    'web_search',
    'Search the live web and read the top results. Use this proactively, without asking permission, whenever the user asks about something recent, time-sensitive, or specific enough that your own knowledge could be wrong or out of date.',
    { query: { type: 'string', description: 'A concise web search query' } },
    ['query'],
  ),

  // Orbit — the user's tasks / notes / projects module. Executed in the renderer.
  fn('orbit_list', 'Read the current Orbit state: all tasks, notes, and projects with their ids. Call this before referring to or modifying existing items.', {}),
  fn('orbit_add_task', 'Add a task to Orbit.', { text: { type: 'string' } }, ['text']),
  fn('orbit_set_task_done', 'Mark an Orbit task done or not done.', { id: { type: 'string' }, done: { type: 'boolean' } }, ['id', 'done']),
  fn('orbit_remove_task', 'Delete an Orbit task.', { id: { type: 'string' } }, ['id']),
  fn('orbit_clear_done_tasks', 'Delete all completed Orbit tasks.', {}),
  fn('orbit_add_note', 'Create an Orbit note.', { title: { type: 'string' }, body: { type: 'string' } }, ['title', 'body']),
  fn('orbit_update_note', 'Update an Orbit note. Only provided fields change.', { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } }, ['id']),
  fn('orbit_remove_note', 'Delete an Orbit note.', { id: { type: 'string' } }, ['id']),
  fn('orbit_add_project', 'Create an Orbit project.', { name: { type: 'string' } }, ['name']),
  fn(
    'orbit_update_project',
    'Update an Orbit project. Only provided fields change.',
    {
      id: { type: 'string' },
      name: { type: 'string' },
      progress: { type: 'number', description: '0–100' },
      status: { type: 'string', enum: ['active', 'paused', 'done'] },
    },
    ['id'],
  ),
  fn('orbit_remove_project', 'Delete an Orbit project.', { id: { type: 'string' } }, ['id']),

  // Atlas — the user's research library of saved articles and snippets. Runs in the main process.
  fn(
    'atlas_search',
    "Search the user's Atlas library (saved articles, snippets, highlights) by keywords. Use this whenever the user refers to something they saved, read, or highlighted.",
    { query: { type: 'string', description: 'Keywords to search the library for' } },
    ['query'],
  ),
  fn(
    'atlas_get_article',
    'Read a saved Atlas article in full: its text, summary, key points, and highlights. Get the id from atlas_search.',
    { id: { type: 'string' } },
    ['id'],
  ),
  fn(
    'atlas_save_url',
    "Save a web page into the user's Atlas library (extracts and archives the article, then summarizes it). Use when the user asks to save, keep, or remember a link.",
    { url: { type: 'string' } },
    ['url'],
  ),
  fn(
    'atlas_list_highlights',
    "List the user's Atlas highlights (passages they marked while reading), optionally filtered by keywords.",
    { query: { type: 'string', description: 'Optional keywords to filter by' } },
  ),
  fn(
    'atlas_save_text',
    "Save a piece of text (e.g. a summary of a file Luna read, or notes) into the user's Atlas library as a saved item. Use when the user asks to file, keep, or archive something into Atlas.",
    { title: { type: 'string' }, text: { type: 'string' } },
    ['text'],
  ),
  fn(
    'atlas_save_file',
    "Read a document from disk (PDF, Word, Excel, text, code, or image) and file it into the user's Atlas library so it becomes searchable and re-readable, keeping a link back to the original file. Use when the user asks to add, save, or keep a document/file in Atlas.",
    { path: { type: 'string', description: 'Absolute path to the file, inside the workspace or a granted folder' } },
    ['path'],
  ),

  // Luna's own filesystem + code capabilities (workspace-scoped, permission-gated)
  ...LUNA_FS_TOOLS,
  // identity: load a skill's playbook, remember durable facts
  ...SOUL_TOOLS,
]

/** Run an Orbit tool in the renderer (where the Orbit store lives) and await its result. */
function runOrbitTool(e: IpcMainEvent, name: string, args: string): Promise<string> {
  return new Promise((resolve) => {
    const invokeId = crypto.randomUUID()
    const ch = `luna:orbit-result:${invokeId}`
    const timer = setTimeout(() => {
      ipcMain.removeAllListeners(ch)
      resolve(JSON.stringify({ error: 'Orbit did not respond.' }))
    }, 5000)
    ipcMain.once(ch, (_ev, result: string) => {
      clearTimeout(timer)
      resolve(result)
    })
    e.sender.send('luna:orbit-call', { invokeId, name, args })
  })
}

interface ChatCard {
  module: 'orbit' | 'atlas' | 'file'
  action: string
  title: string
  subtitle?: string
  itemType?: string
  id?: string
  count?: number
  /** absolute path for a file card — powers in-app preview + reveal-in-folder */
  path?: string
  fileType?: string
}

/** Turn a successful Orbit/Atlas tool result into an inline preview card for the chat. */
function buildCard(name: string, resultJson: string): ChatCard | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let r: any
  try {
    r = JSON.parse(resultJson)
  } catch {
    return null
  }
  if (!r || r.error) return null // never card a failure

  if (name === 'orbit_add_task' && r.task?.text) return { module: 'orbit', action: 'task', title: r.task.text }
  if (name === 'orbit_set_task_done' && r.task?.text) return { module: 'orbit', action: r.task.done ? 'done' : 'task', title: r.task.text }
  if (name === 'orbit_add_note' && r.note) return { module: 'orbit', action: 'note', title: r.note.title || 'Untitled note', subtitle: (r.note.body || '').slice(0, 120) || undefined }
  if ((name === 'orbit_add_project' || name === 'orbit_update_project') && r.project?.name) {
    return { module: 'orbit', action: 'project', title: r.project.name, subtitle: r.project.status || undefined }
  }

  if (name === 'atlas_search' && Array.isArray(r.results) && r.results.length) {
    return {
      module: 'atlas', action: 'search', count: r.results.length,
      title: `${r.results.length} result${r.results.length > 1 ? 's' : ''} in Atlas`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subtitle: r.results.slice(0, 3).map((x: any) => x.title).filter(Boolean).join(' · ') || undefined,
    }
  }
  if (name === 'atlas_get_article' && r.title) return { module: 'atlas', action: 'article', title: r.title, subtitle: r.summary || undefined, id: r.id }
  if ((name === 'atlas_save_url' || name === 'atlas_save_text' || name === 'atlas_save_file') && r.saved) {
    return { module: 'atlas', action: r.alreadySaved ? 'exists' : 'saved', title: r.saved.title, subtitle: r.saved.summary || undefined, id: r.saved.id }
  }

  // a file Luna created or updated → a card the user can preview / reveal
  if ((name === 'write_file' || name === 'export_pdf') && r.ok && typeof r.path === 'string') {
    const title = baseName(r.path)
    const ext = title.includes('.') ? title.slice(title.lastIndexOf('.') + 1).toLowerCase() : ''
    return {
      module: 'file',
      action: r.action === 'overwrite' ? 'updated' : 'created',
      title,
      subtitle: r.path,
      path: r.path,
      ...(ext ? { fileType: ext } : {}),
    }
  }
  return null
}

/** In-flight requests by id so the renderer can cancel them (stop button, thread deleted). */
const inflight = new Map<string, AbortController>()

export function registerLuna() {
  ipcMain.on('luna:cancel', (_e, id: string) => {
    inflight.get(id)?.abort()
  })

  ipcMain.on('luna:chat', async (e, req: ChatRequest) => {
    const { id, messages, temperature } = req
    const chunkCh = `luna:chunk:${id}`
    const stepCh = `luna:step:${id}`
    const cardCh = `luna:card:${id}`
    const doneCh = `luna:done:${id}`
    const errCh = `luna:err:${id}`

    if (!hasKey('main')) {
      e.sender.send(errCh, 'No API key set. Add one in Settings.')
      return
    }

    const controller = new AbortController()
    inflight.set(id, controller)
    const signal = controller.signal
    const convo: ChatMsg[] = messages.map((m) => ({ role: m.role, content: m.content }))
    // main chat runs on Luna's composed identity (soul + rules + skills index + memory);
    // the writing assistant / meeting keep their own prompts and don't set this flag
    if (req.identity) {
      try {
        convo.unshift({ role: 'system', content: composeIdentity() })
      } catch {
        // identity is best-effort — a missing/broken System dir must never block chat
      }
    }

    try {
      // whether any visible text has been streamed so far — so a later round's prose is split
      // from the previous round's with a paragraph break instead of being glued on ("with.Good")
      let emittedText = false
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const withTools = req.tools !== false && round < MAX_ROUNDS
        let roundHasText = false
        const onDelta = (delta: string) => {
          if (!delta) return
          if (!roundHasText && emittedText) e.sender.send(chunkCh, '\n\n')
          roundHasText = true
          emittedText = true
          e.sender.send(chunkCh, delta)
        }
        const { content, toolCalls, textToolCalls } = await streamChat(
          'main',
          convo,
          { temperature, tools: withTools ? TOOLS : undefined, signal },
          onDelta,
        )

        // Execute when there are tool calls to run. streamChat normalizes the finish reason to
        // 'tool_calls' whenever calls are present (some providers report 'stop' or null even when
        // they streamed native tool_calls), so gating on toolCalls.length is the robust check.
        if (toolCalls.length) {
          // Two conversation shapes. Native tool_calls use the standard assistant+tool_calls /
          // tool-role format. Text-format calls (DeepSeek/Hermes/Mistral dialects, from a model
          // that doesn't do native tool calling) use a ReAct transcript instead: the assistant
          // keeps its prose but not the raw call block, and results come back as one user-role
          // observation with a steering nudge — the shape such a model will actually continue
          // from. See textCallAssistantContent / textCallObservationContent.
          if (textToolCalls) {
            convo.push({ role: 'assistant', content: textCallAssistantContent(content, toolCalls) })
          } else {
            convo.push({ role: 'assistant', content: content || null, tool_calls: toolCalls })
          }
          const observations: { name: string; result: string }[] = []
          for (const call of toolCalls) {
            const name = call.function.name
            let pargs: Record<string, unknown> = {}
            try {
              pargs = JSON.parse(call.function.arguments || '{}')
            } catch {
              // malformed arguments — leave empty; the tool reports its own error
            }
            // announce this activity to the renderer: a live step with kind/label/target, then a
            // done/error on completion, plus sub-phase details emitted from inside the executor
            const seed = stepFor(name, pargs)
            const stepId = call.id || crypto.randomUUID()
            const emit = (state: LunaStep['state'], detail?: string) =>
              e.sender.send(stepCh, { id: stepId, kind: seed.kind, label: seed.label, target: seed.target, state, detail } as LunaStep)
            emit('running')

            let result: string
            if (name === 'web_search') {
              const query = typeof pargs.query === 'string' ? pargs.query : ''
              // report pages read as a running sub-phase; archive to the research shelf when opted in
              let pages = 0
              const onDocs = (docs: { url: string; title: string | null; text: string; markdown: string }[]) => {
                pages += docs.length
                emit('running', `reading ${pages} page${pages > 1 ? 's' : ''}…`)
                if (req.research) for (const d of docs) void saveResearchDoc(d.url, d.title, d.text, d.markdown).catch(() => {})
              }
              result = query
                ? await runWebSearch(query, signal, onDocs).catch(
                    (err) => `Search failed: ${err instanceof Error ? err.message : String(err)}`,
                  )
                : 'No query provided.'
            } else if (name.startsWith('atlas_')) {
              result = await runAtlasTool(name, call.function.arguments || '{}', signal)
            } else if (name.startsWith('orbit_')) {
              result = await runOrbitTool(e, name, call.function.arguments || '{}')
            } else if (LUNA_FS_TOOL_NAMES.has(name)) {
              result = await runLunaFsTool(name, call.function.arguments || '{}', {
                event: e,
                signal,
                onDetail: (phase) => { if (phase) emit('running', phase) },
              })
            } else if (SOUL_TOOL_NAMES.has(name)) {
              result = await runSoulTool(name, call.function.arguments || '{}')
            } else {
              result = JSON.stringify({ error: `Unknown tool: ${name}` })
            }
            const outcome = outcomeOf(name, result)
            emit(outcome.ok ? 'done' : 'error', outcome.detail)
            const card = buildCard(name, result)
            if (card) e.sender.send(cardCh, card)
            if (textToolCalls) {
              observations.push({ name, result })
            } else {
              convo.push({ role: 'tool', tool_call_id: call.id, content: result })
            }
          }
          // For text-format calls, deliver all results as one observation the model continues from.
          if (textToolCalls && observations.length) {
            convo.push({ role: 'user', content: textCallObservationContent(observations) })
          }
          continue
        }

        break
      }
      e.sender.send(doneCh)
    } catch (error) {
      // a cancelled request is a normal completion, not an error
      if (signal.aborted) e.sender.send(doneCh)
      else if (isNoKey(error)) e.sender.send(errCh, 'No API key set. Add one in Settings.')
      else e.sender.send(errCh, error instanceof Error ? error.message : String(error))
    } finally {
      inflight.delete(id)
    }
  })
}
