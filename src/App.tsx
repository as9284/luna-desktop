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

  // Luna's Orbit tools execute here, where the Orbit store lives
  useEffect(() => window.api?.onOrbitCall?.(executeOrbitTool), [])

  // any Atlas mutation (including ones Luna makes from chat) refreshes the library view
  useEffect(() => window.api?.atlas?.onChanged?.(() => void useAtlas.getState().refresh()), [])

  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reducedMotion)
  }, [reducedMotion])

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
