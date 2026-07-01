import { useEffect, useLayoutEffect } from 'react'
import Titlebar from './components/Titlebar'
import Home from './views/Home'
import Chat from './views/Chat'
import Orbit from './views/Orbit'
import Settings from './views/Settings'
import Updater from './components/Updater'
import { Toaster } from './ui'
import { goHome } from './lib/router'

export default function App() {
  // Hide the non-home views before first paint so there's no flash.
  useLayoutEffect(() => {
    for (const id of ['luna', 'module', 'settings']) {
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
        <Settings />
      </div>
      <Updater />
      <Toaster />
    </div>
  )
}
