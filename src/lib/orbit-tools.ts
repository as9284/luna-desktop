import { useOrbit } from '../store/orbit'

/**
 * Executes an Orbit tool call from Luna (forwarded by the main process) against the
 * renderer's Orbit store. Returns a JSON string that becomes the tool result.
 */
export function executeOrbitTool(name: string, argsJson: string): string {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(argsJson || '{}')
  } catch {
    return JSON.stringify({ error: 'Malformed tool arguments.' })
  }

  const s = useOrbit.getState()
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined)

  switch (name) {
    case 'orbit_list':
      return JSON.stringify({ tasks: s.tasks, notes: s.notes, projects: s.projects })

    case 'orbit_add_task': {
      const text = str('text')?.trim()
      if (!text) return JSON.stringify({ error: 'text is required.' })
      s.addTask(text)
      const task = useOrbit.getState().tasks.at(-1)
      return JSON.stringify({ ok: true, task })
    }
    case 'orbit_set_task_done': {
      const task = s.tasks.find((t) => t.id === args.id)
      if (!task) return JSON.stringify({ error: 'No task with that id.' })
      if (task.done !== !!args.done) s.toggleTask(task.id)
      return JSON.stringify({ ok: true, task: { ...task, done: !!args.done } })
    }
    case 'orbit_remove_task': {
      if (!s.tasks.some((t) => t.id === args.id)) return JSON.stringify({ error: 'No task with that id.' })
      s.removeTask(args.id as string)
      return JSON.stringify({ ok: true })
    }
    case 'orbit_clear_done_tasks': {
      const n = s.tasks.filter((t) => t.done).length
      s.clearDone()
      return JSON.stringify({ ok: true, removed: n })
    }

    case 'orbit_add_note': {
      const id = s.addNote()
      useOrbit.getState().updateNote(id, { title: str('title') ?? '', body: str('body') ?? '' })
      const note = useOrbit.getState().notes.find((n) => n.id === id)
      return JSON.stringify({ ok: true, note })
    }
    case 'orbit_update_note': {
      if (!s.notes.some((n) => n.id === args.id)) return JSON.stringify({ error: 'No note with that id.' })
      const patch: { title?: string; body?: string } = {}
      if (str('title') !== undefined) patch.title = str('title')
      if (str('body') !== undefined) patch.body = str('body')
      s.updateNote(args.id as string, patch)
      const note = useOrbit.getState().notes.find((n) => n.id === args.id)
      return JSON.stringify({ ok: true, note })
    }
    case 'orbit_remove_note': {
      if (!s.notes.some((n) => n.id === args.id)) return JSON.stringify({ error: 'No note with that id.' })
      s.removeNote(args.id as string)
      return JSON.stringify({ ok: true })
    }

    case 'orbit_add_project': {
      const name_ = str('name')?.trim()
      if (!name_) return JSON.stringify({ error: 'name is required.' })
      s.addProject(name_)
      const project = useOrbit.getState().projects.at(-1)
      return JSON.stringify({ ok: true, project })
    }
    case 'orbit_update_project': {
      if (!s.projects.some((p) => p.id === args.id)) return JSON.stringify({ error: 'No project with that id.' })
      const patch: { name?: string; progress?: number; status?: 'active' | 'paused' | 'done' } = {}
      if (str('name') !== undefined) patch.name = str('name')
      if (typeof args.progress === 'number') patch.progress = Math.max(0, Math.min(100, args.progress))
      if (args.status === 'active' || args.status === 'paused' || args.status === 'done') patch.status = args.status
      s.updateProject(args.id as string, patch)
      const project = useOrbit.getState().projects.find((p) => p.id === args.id)
      return JSON.stringify({ ok: true, project })
    }
    case 'orbit_remove_project': {
      if (!s.projects.some((p) => p.id === args.id)) return JSON.stringify({ error: 'No project with that id.' })
      s.removeProject(args.id as string)
      return JSON.stringify({ ok: true })
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}
