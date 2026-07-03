import { ipcMain } from 'electron'
import { complete, hasKey } from '../llm'

export interface MeetingArtifacts {
  note: { title: string; content: string }
  tasks: string[]
  project: { name: string } | null
  warning: string | null
}

interface SummarizeRequest {
  title: string
  notes: string[]
}

/** Deterministic wrap-up used when the AI is unreachable so ending a meeting never loses notes. */
function fallback(title: string, notes: string[]): MeetingArtifacts {
  const content = ['SUMMARY', `Notes captured during "${title || 'the meeting'}".`, '', 'NOTES', ...notes.map((n) => `- ${n}`)].join('\n')
  return {
    note: { title: title || 'Meeting notes', content },
    tasks: [],
    project: title ? { name: title } : null,
    warning: null,
  }
}

function buildPrompt(title: string, notes: string[]): string {
  return [
    'You are Luna. Turn raw meeting notes into an organized record.',
    'Respond with raw JSON ONLY — no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{"note":{"title":"string","content":"string"},"tasks":["string"],"project":"string"}',
    '',
    'note.content rules:',
    '- Plain text only. NO markdown symbols (no #, no *, no backticks).',
    '- Use UPPERCASE section labels on their own line: SUMMARY, DECISIONS, RISKS, ACTION ITEMS. Include only the sections the notes actually support.',
    '- Under a section, put each point on its own line starting with "- ".',
    '- Stay faithful to the notes. Do not invent facts.',
    '',
    'tasks rules:',
    '- Each string is one concrete follow-up action, starting with a verb.',
    '- Include only real action items from the notes. Use an empty array if there are none.',
    '',
    'project rules:',
    '- A short project name (2-4 words) this meeting belongs under. Use an empty string if none is meaningful.',
    '',
    `Meeting title: ${title}`,
    'Notes:',
    ...notes.map((n, i) => `${i + 1}. ${n}`),
  ].join('\n')
}

function parseArtifacts(raw: string): Omit<MeetingArtifacts, 'warning'> | null {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  // Tolerate leading/trailing prose by isolating the outermost JSON object.
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first > 0 || last < text.length - 1) {
    if (first !== -1 && last !== -1 && last > first) text = text.slice(first, last + 1)
  }
  try {
    const o = JSON.parse(text)
    const note = o.note ?? {}
    const noteTitle = typeof note.title === 'string' && note.title.trim() ? note.title.trim() : 'Meeting notes'
    const noteContent = typeof note.content === 'string' ? note.content.trim() : ''
    const tasks = Array.isArray(o.tasks)
      ? o.tasks.filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0).map((t: string) => t.trim())
      : []
    const projName = typeof o.project === 'string' ? o.project.trim() : ''
    return { note: { title: noteTitle, content: noteContent }, tasks, project: projName ? { name: projName } : null }
  } catch {
    return null
  }
}

export function registerMeeting() {
  ipcMain.handle('meeting:summarize', async (_e, req: SummarizeRequest): Promise<MeetingArtifacts> => {
    const title = (req.title ?? '').trim()
    const notes = (req.notes ?? []).map((n) => n.trim()).filter(Boolean)
    if (notes.length === 0) {
      return { note: { title: title || 'Meeting notes', content: '' }, tasks: [], project: null, warning: 'No notes to summarize.' }
    }

    if (!hasKey('main')) return { ...fallback(title, notes), warning: 'No API key set — saved your raw notes. Add a key in Settings for AI summaries.' }

    try {
      const content = await complete('main', [{ role: 'user', content: buildPrompt(title, notes) }], { temperature: 0.4 })
      const parsed = parseArtifacts(content)
      if (!parsed) throw new Error('unreadable response')
      return { ...parsed, warning: null }
    } catch (err) {
      return { ...fallback(title, notes), warning: `AI wrap-up failed (${err instanceof Error ? err.message : String(err)}). Saved your raw notes instead.` }
    }
  })
}
