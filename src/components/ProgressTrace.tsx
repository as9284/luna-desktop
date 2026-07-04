import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ActivityGlyph, TickGlyph } from './ActivityGlyph'
import './activity.css'

/**
 * Luna's processing feedback. `ProgressTrace` is the live stack shown while she works — steps
 * accumulate, the running one lit and animating, finished ones ticked. `SavedTrace` is the
 * compact, reopenable record that stays on the finished message. Both driven by LunaStep[].
 */

function StepRow({ step }: { step: LunaStep }) {
  const finished = step.state === 'done' || step.state === 'error'
  return (
    <div className={`astep astep--${step.state}`}>
      <div className="astep-glyph">
        <ActivityGlyph kind={step.kind} />
      </div>
      <div className="astep-text">
        <div className="astep-label">
          {step.label}
          {step.target ? <b> {step.target}</b> : null}
        </div>
        {step.detail && <div className="astep-sub">{step.detail}</div>}
      </div>
      <div className="astep-meta">{step.state === 'done' ? <TickGlyph /> : finished ? <span className="astep-x" /> : null}</div>
    </div>
  )
}

export function ProgressTrace({ steps, thinking }: { steps: LunaStep[]; thinking: boolean }) {
  if (!steps.length && !thinking) return null
  return (
    <div className="ptrace" role="status" aria-live="polite">
      <div className="ptrace-rail" />
      {steps.map((s) => (
        <StepRow key={s.id} step={s} />
      ))}
      {thinking && (
        <div className="astep astep--running astep--ghost">
          <div className="astep-glyph">
            <ActivityGlyph kind="think" />
          </div>
          <div className="astep-text">
            <div className="astep-label astep-label--muted">Thinking…</div>
          </div>
          <div className="astep-meta" />
        </div>
      )}
    </div>
  )
}

const plural = (n: number) => `${n} step${n === 1 ? '' : 's'}`

export function SavedTrace({ steps }: { steps: LunaStep[] }) {
  const [open, setOpen] = useState(false)
  if (!steps.length) return null
  const failed = steps.filter((s) => s.state === 'error').length
  const caption = failed ? `${plural(steps.length)} · ${failed} failed` : plural(steps.length)
  return (
    <div className={`svtrace${open ? ' open' : ''}`}>
      <button className="svtrace-bar" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="svtrace-glyphs">
          {steps.slice(0, 6).map((s) => (
            <span key={s.id} className={`svtrace-mini${s.state === 'error' ? ' err' : ''}`}>
              <ActivityGlyph kind={s.kind} />
            </span>
          ))}
        </span>
        <span className="svtrace-cap">{caption}</span>
        <ChevronDown className="svtrace-chev" size={14} />
      </button>
      {open && (
        <div className="svtrace-body">
          {steps.map((s) => (
            <div key={s.id} className={`svtrace-line${s.state === 'error' ? ' err' : ''}`}>
              <span className="svtrace-g">
                <ActivityGlyph kind={s.kind} />
              </span>
              <span className="svtrace-l">
                {s.label}
                {s.target ? <b> {s.target}</b> : null}
                {s.state === 'error' && s.detail ? <span className="svtrace-reason"> — {s.detail}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
