import fs from 'node:fs'

/**
 * The activity log — a durable record of every file Luna read, wrote, or deleted, shown in
 * the edge drawer. Append-only, capped, persisted as JSON. Emits on each entry so the
 * renderer's drawer updates live.
 */

export interface Activity {
  id: string
  at: number
  action: string
  target: string
  ok: boolean
  detail?: string
}

const CAP = 500
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)

export function createActivityLog(deps: { file: string; emit?: (entry: Activity) => void }) {
  let entries: Activity[] = []
  try {
    const raw = JSON.parse(fs.readFileSync(deps.file, 'utf8'))
    if (Array.isArray(raw)) entries = raw.slice(-CAP)
  } catch {
    // no log yet — start empty
  }

  const persist = () => {
    try {
      fs.writeFileSync(deps.file, JSON.stringify(entries.slice(-CAP)))
    } catch {
      // logging must never break an operation
    }
  }

  return {
    push(e: { action: string; target: string; ok: boolean; detail?: string }): Activity {
      const entry: Activity = { id: uid(), at: Date.now(), ...e }
      entries.push(entry)
      if (entries.length > CAP) entries = entries.slice(-CAP)
      persist()
      deps.emit?.(entry)
      return entry
    },
    recent(limit = 100): Activity[] {
      return entries.slice(-limit).reverse()
    },
    clear() {
      entries = []
      persist()
    },
  }
}

export type ActivityLog = ReturnType<typeof createActivityLog>
