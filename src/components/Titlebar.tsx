import { useUI } from '../store/ui'
import { openSettings } from '../lib/router'

export default function Titlebar() {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const view = useUI((s) => s.view)
  const moduleName = useUI((s) => s.module)

  const loc =
    view === 'luna'
      ? 'luna · conversation'
      : view === 'module'
        ? `${(moduleName ?? '').toLowerCase()} · module`
        : view === 'settings'
          ? 'settings'
          : 'all systems nominal'

  return (
    <div className="titlebar">
      <div className="brand">
        <span className="mark" />
        <span className="word">Luna</span>
        <span className="ver">v0.1</span>
      </div>

      <div className="tb-status">
        <span className="dot" />
        {loc}
      </div>

      <div className="tb-right">
        <button className="tb-settings" aria-label="Settings" onClick={openSettings}>
          <svg viewBox="0 0 24 24">
            <path d="M4 7h9M19 7h1M4 12h1M11 12h9M4 17h11M21 17h-1" />
            <circle cx="16" cy="7" r="2.2" />
            <circle cx="8" cy="12" r="2.2" />
            <circle cx="18" cy="17" r="2.2" />
          </svg>
        </button>
        <span className="tb-div" />
        <div className="winctl">
          <button aria-label="Minimize" onClick={() => api?.minimize()}>
            <svg viewBox="0 0 14 14">
              <path d="M3 7h8" />
            </svg>
          </button>
          <button aria-label="Maximize" onClick={() => api?.maximize()}>
            <svg viewBox="0 0 14 14">
              <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="1.2" />
            </svg>
          </button>
          <button aria-label="Close" onClick={() => api?.close()}>
            <svg viewBox="0 0 14 14">
              <path d="M4 4l6 6M10 4l-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
