import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Cpu, Sparkles, Palette, Library, Info } from 'lucide-react'
import { Badge, Button, Field, Input, Segmented, Switch, toast } from '../ui'
import { goHome } from '../lib/router'
import { useSettings, type Accent, type UiScale, type ReadFont, type ReadSize, type Ambient } from '../store/settings'
import SoulPanel from './SoulPanel'
import './settings.css'

// swatch colours mirror the --accent presets in index.css
const ACCENTS: { id: Accent; label: string; color: string }[] = [
  { id: 'lunar', label: 'Lunar', color: '#cfd6e6' },
  { id: 'violet', label: 'Violet', color: '#cbb4ff' },
  { id: 'teal', label: 'Teal', color: '#b6efeb' },
  { id: 'amber', label: 'Amber', color: '#ffddab' },
  { id: 'rose', label: 'Rose', color: '#ffccd6' },
  { id: 'sage', label: 'Sage', color: '#a6e5b4' },
]

const PROTOCOL_HINT: Record<LlmProtocol, { base: string; model: string }> = {
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o  ·  deepseek-v4-flash  ·  …' },
  anthropic: { base: 'https://api.anthropic.com', model: 'claude-opus-4-8  ·  claude-sonnet-5  ·  …' },
}

/** One configurable model slot: protocol · base URL · model · API key. */
function ModelCard({
  title,
  subtitle,
  cfg,
  onConfig,
  onSaveKey,
  onRemoveKey,
  onTest,
}: {
  title: string
  subtitle: string
  cfg: LlmSlotConfig
  onConfig: (patch: { protocol?: LlmProtocol; baseUrl?: string; model?: string }) => void
  onSaveKey: (key: string) => void
  onRemoveKey: () => void
  onTest: () => Promise<{ ok: boolean; error?: string }>
}) {
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl)
  const [model, setModel] = useState(cfg.model)
  const [keyInput, setKeyInput] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // keep local fields in sync if the config reloads (e.g. protocol default swap)
  useEffect(() => setBaseUrl(cfg.baseUrl), [cfg.baseUrl])
  useEffect(() => setModel(cfg.model), [cfg.model])
  // a stale "Connected" is misleading once anything changes — clear it
  useEffect(() => setResult(null), [cfg.protocol, cfg.baseUrl, cfg.model, cfg.hasKey])

  const runTest = async () => {
    setTesting(true)
    setResult(null)
    const r = await onTest()
    setResult({ ok: r.ok, msg: r.ok ? 'Connection OK' : r.error || 'Connection failed' })
    setTesting(false)
  }

  const hint = PROTOCOL_HINT[cfg.protocol]

  return (
    <div className="model-slot">
      <div className="model-slot-head">
        <div>
          <span className="model-slot-title">{title}</span>
          <span className="model-slot-sub">{subtitle}</span>
        </div>
        <Badge variant={cfg.hasKey ? 'solid' : 'outline'}>{cfg.hasKey ? 'Connected' : 'Not set'}</Badge>
      </div>

      <Field label="Protocol">
        <Segmented
          options={[
            { id: 'openai', label: 'OpenAI-compatible' },
            { id: 'anthropic', label: 'Anthropic' },
          ]}
          value={cfg.protocol}
          onChange={(id) => onConfig({ protocol: id as LlmProtocol })}
        />
      </Field>

      <div className="field-grid">
        <Field label="Base URL">
          <Input
            placeholder={hint.base}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={() => baseUrl.trim() && baseUrl !== cfg.baseUrl && onConfig({ baseUrl: baseUrl.trim() })}
          />
        </Field>
        <Field label="Model">
          <Input
            placeholder={hint.model}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => model.trim() && model !== cfg.model && onConfig({ model: model.trim() })}
          />
        </Field>
      </div>

      <Field label="API key" help={cfg.hasKey ? 'A key is saved and encrypted on this device.' : 'Stored encrypted locally — never leaves your machine except to this endpoint.'}>
        <div className="row-inline">
          <Input
            type="password"
            placeholder={cfg.hasKey ? '••••••••••  saved' : 'sk-…'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && keyInput.trim()) {
                onSaveKey(keyInput.trim())
                setKeyInput('')
              }
            }}
            style={{ flex: 1 }}
          />
          <Button
            variant="primary"
            small
            disabled={!keyInput.trim()}
            onClick={() => {
              onSaveKey(keyInput.trim())
              setKeyInput('')
            }}
          >
            Save
          </Button>
          {cfg.hasKey && (
            <Button variant="danger" small onClick={onRemoveKey}>
              Remove
            </Button>
          )}
        </div>
      </Field>

      <div className="model-test">
        <Button variant="secondary" small onClick={runTest} disabled={testing || !cfg.hasKey}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        {result && <span className={'test-result ' + (result.ok ? 'ok' : 'bad')}>{result.msg}</span>}
      </div>
    </div>
  )
}

type Category = 'models' | 'luna' | 'appearance' | 'atlas' | 'about'

const CATEGORIES: { id: Category; label: string; hint: string; icon: ReactNode }[] = [
  { id: 'models', label: 'Models', hint: 'Endpoints & keys', icon: <Cpu size={16} /> },
  { id: 'luna', label: 'Luna', hint: 'Personality & skills', icon: <Sparkles size={16} /> },
  { id: 'appearance', label: 'Appearance', hint: 'Motion', icon: <Palette size={16} /> },
  { id: 'atlas', label: 'Atlas', hint: 'Research library', icon: <Library size={16} /> },
  { id: 'about', label: 'About', hint: 'Version & updates', icon: <Info size={16} /> },
]

function PaneHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="pane-head">
      <h1>{title}</h1>
      {sub && <p className="pane-sub">{sub}</p>}
    </header>
  )
}

export default function Settings() {
  const s = useSettings()
  const [active, setActive] = useState<Category>('models')
  const [llm, setLlm] = useState<{ main: LlmSlotConfig; vision: LlmSlotConfig } | null>(null)
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const awaitingCheck = useRef(false)

  useEffect(() => {
    window.api?.llm?.get().then(setLlm).catch(() => {})
    window.api?.updates?.version().then(setVersion).catch(() => {})
    return window.api?.updates?.onEvent((e) => {
      if (!awaitingCheck.current) return
      if (e.type === 'available') {
        awaitingCheck.current = false
        setChecking(false)
        toast(`Update available — v${e.payload.version}`)
      } else if (e.type === 'none') {
        awaitingCheck.current = false
        setChecking(false)
        toast('Up to date — you have the latest version')
      } else if (e.type === 'error') {
        awaitingCheck.current = false
        setChecking(false)
        toast('Update check failed')
      }
    })
  }, [])

  const patchLocal = (slot: LlmSlot, patch: Partial<LlmSlotConfig>) =>
    setLlm((prev) => (prev ? { ...prev, [slot]: { ...prev[slot], ...patch } } : prev))

  const onConfig = (slot: LlmSlot) => (patch: { protocol?: LlmProtocol; baseUrl?: string; model?: string }) => {
    patchLocal(slot, patch)
    void window.api?.llm?.setConfig(slot, patch)
  }
  const onSaveKey = (slot: LlmSlot) => (key: string) => {
    if (!key) return
    void window.api?.llm?.setKey(slot, key)
    patchLocal(slot, { hasKey: true })
    toast('API key saved')
  }
  const onRemoveKey = (slot: LlmSlot) => () => {
    void window.api?.llm?.clearKey(slot)
    patchLocal(slot, { hasKey: false })
    toast('API key removed')
  }
  const onTest = (slot: LlmSlot) => async () =>
    (await window.api?.llm?.test(slot)) ?? { ok: false, error: 'Desktop bridge unavailable.' }

  const checkUpdates = async () => {
    const r = await window.api?.updates?.check()
    if (!r) return
    if (!r.ok) {
      toast(r.reason === 'dev' ? 'Updates are available in the installed app' : 'Update check failed')
      return
    }
    awaitingCheck.current = true
    setChecking(true)
  }

  return (
    <div className="view settings-view" id="settings">
      <div className="settings-shell">
        <nav className="settings-nav">
          <button className="settings-back" onClick={goHome}>
            <svg viewBox="0 0 14 14">
              <path d="M9 3l-4 4 4 4" />
            </svg>
            System
          </button>
          <div className="settings-brand">Settings</div>
          <div className="settings-nav-list">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={'settings-nav-item' + (active === c.id ? ' on' : '')}
                onClick={() => setActive(c.id)}
              >
                <span className="settings-nav-ic">{c.icon}</span>
                <span className="settings-nav-txt">
                  <span className="settings-nav-label">{c.label}</span>
                  <span className="settings-nav-hint">{c.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </nav>

        <div className="settings-pane scroll-y">
          <div className="settings-pane-inner">
            {active === 'models' && (
              <>
                <PaneHead
                  title="Models"
                  sub="Luna runs on any OpenAI-compatible or Anthropic-compatible endpoint. Set a main model for chat, and an optional vision model so she can read images and screenshots."
                />
                {llm && (
                  <div className="model-slots">
                    <ModelCard
                      title="Main model"
                      subtitle="Chat · writing · summaries"
                      cfg={llm.main}
                      onConfig={onConfig('main')}
                      onSaveKey={onSaveKey('main')}
                      onRemoveKey={onRemoveKey('main')}
                      onTest={onTest('main')}
                    />
                    <ModelCard
                      title="Vision model"
                      subtitle="Reads images & screenshots"
                      cfg={llm.vision}
                      onConfig={onConfig('vision')}
                      onSaveKey={onSaveKey('vision')}
                      onRemoveKey={onRemoveKey('vision')}
                      onTest={onTest('vision')}
                    />
                  </div>
                )}
              </>
            )}

            {active === 'luna' && (
              <>
                <PaneHead
                  title="Luna"
                  sub="Her personality, standing orders, memory, and skills — all editable files in your workspace. Shape her however you like; changes take effect on her next reply."
                />
                <SoulPanel />
              </>
            )}

            {active === 'appearance' && (
              <>
                <PaneHead title="Appearance" sub="Make Luna yours — accent, scale, reading text, and ambience. Dark, always." />

                <div className="appear-field">
                  <div className="pane-row-txt">
                    <span className="pane-row-label">Accent color</span>
                    <span className="pane-row-hint">Tints highlights, active items, focus rings, and status glows.</span>
                  </div>
                  <div className="accent-swatches">
                    {ACCENTS.map((a) => (
                      <button
                        key={a.id}
                        className={'accent-sw' + (s.accent === a.id ? ' on' : '')}
                        onClick={() => s.set({ accent: a.id })}
                        title={a.label}
                        aria-label={a.label}
                      >
                        <span className="accent-dot" style={{ background: a.color }} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="appear-field">
                  <div className="pane-row-txt">
                    <span className="pane-row-label">Interface scale</span>
                    <span className="pane-row-hint">Zoom the whole interface up or down for comfort.</span>
                  </div>
                  <Segmented
                    options={[
                      { id: 'compact', label: 'Compact' },
                      { id: 'default', label: 'Default' },
                      { id: 'large', label: 'Large' },
                    ]}
                    value={s.uiScale}
                    onChange={(id) => s.set({ uiScale: id as UiScale })}
                  />
                </div>

                <div className="appear-field">
                  <div className="pane-row-txt">
                    <span className="pane-row-label">Reading font</span>
                    <span className="pane-row-hint">Font for long-form text — chat answers and the Atlas reader. Doesn't touch the UI.</span>
                  </div>
                  <Segmented
                    options={[
                      { id: 'sans', label: 'Sans' },
                      { id: 'serif', label: 'Serif' },
                    ]}
                    value={s.readFont}
                    onChange={(id) => s.set({ readFont: id as ReadFont })}
                  />
                </div>

                <div className="appear-field">
                  <div className="pane-row-txt">
                    <span className="pane-row-label">Reading size</span>
                    <span className="pane-row-hint">Body-text size in chat answers and the reader.</span>
                  </div>
                  <Segmented
                    options={[
                      { id: 'small', label: 'Small' },
                      { id: 'default', label: 'Default' },
                      { id: 'large', label: 'Large' },
                    ]}
                    value={s.readSize}
                    onChange={(id) => s.set({ readSize: id as ReadSize })}
                  />
                  <div className="appear-preview">
                    The quick brown fox jumps over the lazy dog — 0123456789. This is how Luna's chat answers and the Atlas
                    reader will look.
                  </div>
                </div>

                <div className="appear-field">
                  <div className="pane-row-txt">
                    <span className="pane-row-label">Ambient background</span>
                    <span className="pane-row-hint">The starfield and background glow. Turn it down for a calmer, flatter look.</span>
                  </div>
                  <Segmented
                    options={[
                      { id: 'full', label: 'Full' },
                      { id: 'subtle', label: 'Subtle' },
                      { id: 'off', label: 'Off' },
                    ]}
                    value={s.ambient}
                    onChange={(id) => s.set({ ambient: id as Ambient })}
                  />
                </div>

                <div className="pane-row">
                  <div className="pane-row-txt">
                    <span className="pane-row-label">Reduce motion</span>
                    <span className="pane-row-hint">Tone down transitions and the depth-dolly between views.</span>
                  </div>
                  <Switch checked={s.reducedMotion} onChange={(v) => s.set({ reducedMotion: v })} />
                </div>
              </>
            )}

            {active === 'atlas' && (
              <>
                <PaneHead title="Atlas" sub="Your research library." />
                <div className="pane-row">
                  <div className="pane-row-txt">
                    <span className="pane-row-label">Keep research sources</span>
                    <span className="pane-row-hint">
                      When Luna searches the web in chat, the pages she reads are archived to a “research” shelf — so
                      nothing she cited is ever lost.
                    </span>
                  </div>
                  <Switch checked={s.researchShelf} onChange={(v) => s.set({ researchShelf: v })} />
                </div>
              </>
            )}

            {active === 'about' && (
              <>
                <PaneHead title="About" />
                <div className="about-card">
                  <div className="about-mark">L</div>
                  <div className="about-meta">
                    <span className="about-name">Luna Desktop</span>
                    <span className="about-tag">A personal AI you visit, not an app you open.</span>
                    <div className="about-ver">
                      <Badge variant="outline">v{version || '—'}</Badge>
                      <Button variant="secondary" small onClick={checkUpdates} disabled={checking}>
                        {checking ? 'Checking…' : 'Check for updates'}
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
