import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, Field, Input, Segmented, Switch, toast } from '../ui'
import { goHome } from '../lib/router'
import { useSettings, type Mode } from '../store/settings'
import './settings.css'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sec-block">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export default function Settings() {
  const s = useSettings()
  const [keyInput, setKeyInput] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const awaitingCheck = useRef(false)

  useEffect(() => {
    window.api?.hasKey?.('deepseek').then(setHasKey)
    window.api?.updates?.version().then(setVersion).catch(() => {})
    // Only report results for a check the user actually triggered, so the silent
    // launch auto-check never toasts.
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

  const saveKey = async () => {
    const k = keyInput.trim()
    if (!k) return
    await window.api?.saveKey?.('deepseek', k)
    setHasKey(true)
    setKeyInput('')
    toast('DeepSeek key saved')
  }

  const removeKey = async () => {
    await window.api?.clearKey?.('deepseek')
    setHasKey(false)
    toast('DeepSeek key removed')
  }

  return (
    <div className="view settings-view" id="settings">
      <div className="settings-scroll scroll-y">
        <div className="settings-col">
          <div className="settings-head">
            <button className="backbtn" onClick={goHome}>
              <svg viewBox="0 0 14 14">
                <path d="M9 3l-4 4 4 4" />
              </svg>
              System
            </button>
            <h1>Settings</h1>
          </div>

          <Section title="Engine">
            <Field
              label="DeepSeek API key"
              help={hasKey ? 'A key is saved and encrypted on this device.' : 'Enter your DeepSeek key to bring Luna online.'}
            >
              <div className="row-inline">
                <Input
                  type="password"
                  placeholder={hasKey ? '••••••••••  saved' : 'sk-…'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveKey()
                  }}
                  style={{ flex: 1 }}
                />
                <Button variant="primary" small onClick={saveKey} disabled={!keyInput.trim()}>
                  Save
                </Button>
                {hasKey && (
                  <Button variant="danger" small onClick={removeKey}>
                    Remove
                  </Button>
                )}
              </div>
            </Field>

            <div className="row-inline">
              <Badge variant={hasKey ? 'solid' : 'outline'}>{hasKey ? 'Connected' : 'Not set'}</Badge>
              <span className="muted">Model · deepseek-v4-flash</span>
            </div>

            <Field label="Response mode">
              <Segmented
                options={[
                  { id: 'concise', label: 'Concise' },
                  { id: 'balanced', label: 'Balanced' },
                  { id: 'creative', label: 'Creative' },
                ]}
                value={s.mode}
                onChange={(id) => s.set({ mode: id as Mode })}
              />
            </Field>
          </Section>

          <Section title="Appearance">
            <Switch checked={s.reducedMotion} onChange={(v) => s.set({ reducedMotion: v })} label="Reduce motion" />
          </Section>

          <Section title="Atlas">
            <Switch
              checked={s.researchShelf}
              onChange={(v) => s.set({ researchShelf: v })}
              label="Keep research sources"
            />
            <p className="muted">
              When Luna searches the web in chat, the pages she reads are archived to the Atlas library on a
              “research” shelf, so nothing she cited is ever lost.
            </p>
          </Section>

          <Section title="About">
            <div className="settings-about">
              <span className="name">Luna Desktop</span>
              <Badge variant="outline">v{version || '—'}</Badge>
            </div>
            <p className="muted">A personal AI you visit, not an app you open.</p>
            <div className="row-inline">
              <Button variant="secondary" small onClick={checkUpdates} disabled={checking}>
                {checking ? 'Checking…' : 'Check for updates'}
              </Button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
