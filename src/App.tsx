import { useEffect, useLayoutEffect } from 'react'
import Titlebar from './components/Titlebar'
import Home from './views/Home'
import Chat from './views/Chat'
import Orbit from './views/Orbit'
import Atlas from './views/Atlas'
import Settings from './views/Settings'
import Updater from './components/Updater'
import { ContextMenuHost, Toaster } from './ui'
import { goHome } from './lib/router'
import { executeOrbitTool } from './lib/orbit-tools'
import { useSettings } from './store/settings'
import { useAtlas } from './store/atlas'

export default function App() {
  const reducedMotion = useSettings((s) => s.reducedMotion)
  const accent = useSettings((s) => s.accent)
  const uiScale = useSettings((s) => s.uiScale)
  const readFont = useSettings((s) => s.readFont)
  const readSize = useSettings((s) => s.readSize)
  const ambient = useSettings((s) => s.ambient)

  // Luna's Orbit tools execute here, where the Orbit store lives
  useEffect(() => window.api?.onOrbitCall?.(executeOrbitTool), [])

  // any Atlas mutation (including ones Luna makes from chat) refreshes the library view
  useEffect(() => window.api?.atlas?.onChanged?.(() => void useAtlas.getState().refresh()), [])

  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reducedMotion)
  }, [reducedMotion])

  // appearance → data-* attributes on <html> drive the CSS variable presets (see index.css).
  // Defaults carry no attribute so the :root fallbacks apply.
  useEffect(() => {
    const root = document.documentElement
    const attr = (name: string, value: string, isDefault: boolean) =>
      isDefault ? root.removeAttribute(name) : root.setAttribute(name, value)
    attr('data-accent', accent, accent === 'lunar')
    attr('data-read-font', readFont, readFont === 'sans')
    attr('data-read-size', readSize, readSize === 'default')
    attr('data-ambient', ambient, ambient === 'full')
  }, [accent, readFont, readSize, ambient])

  // interface scale: true page zoom (reflows to fit the window; covers portaled UI like the
  // lightbox and context menus, which CSS zoom on #root would miss)
  useEffect(() => {
    const factor = uiScale === 'compact' ? 0.9 : uiScale === 'large' ? 1.1 : 1
    window.api?.setZoom?.(factor)
  }, [uiScale])

  // Hide the non-home views before first paint so there's no flash.
  useLayoutEffect(() => {
    for (const id of ['luna', 'module', 'atlas', 'settings']) {
      const el = document.getElementById(id)
      if (el) el.hidden = true
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') goHome()
      // Ctrl/Cmd+Shift+N opens another window (Ctrl+N is taken by "new conversation")
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        window.api?.newWindow?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <Titlebar />
      <div className="viewport">
        <Home />
        <Chat />
        <Orbit />
        <Atlas />
        <Settings />
      </div>
      <Updater />
      <Toaster />
      <ContextMenuHost />
    </div>
  )
}
