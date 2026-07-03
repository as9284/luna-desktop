import { useUI, type View } from '../store/ui'

const el = (id: string) => document.getElementById(id)

/**
 * Dark depth-dolly. Forward pushes in; back pulls out.
 * Transform/will-change live only on the transition classes so backdrop-filter
 * surfaces are never isolated by a transforming ancestor at rest.
 */
function go(from: HTMLElement, to: HTMLElement, dir: 'in' | 'out') {
  const out = dir === 'in' ? 'out-fwd' : 'out-back'
  const inn = dir === 'in' ? 'in-fwd' : 'in-back'
  to.classList.add(inn)
  to.hidden = false
  void to.offsetHeight
  from.classList.add(out)
  const settle = () => to.classList.remove(inn)
  requestAnimationFrame(settle)
  setTimeout(settle, 140)
  setTimeout(() => {
    from.hidden = true
    from.classList.remove(out)
    useUI.getState().set({ busy: false })
  }, 280)
}

export function openLuna() {
  const s = useUI.getState()
  const home = el('home')
  const luna = el('luna')
  if (s.view !== 'home' || s.busy || !home || !luna) return
  s.set({ busy: true, view: 'luna' })
  go(home, luna, 'in')
}

export function openModule(name: string) {
  const s = useUI.getState()
  const home = el('home')
  const mod = el('module')
  if (s.view !== 'home' || s.busy || !home || !mod) return
  s.set({ busy: true, view: 'module', module: name })
  go(home, mod, 'in')
}

export function openAtlas() {
  const s = useUI.getState()
  const home = el('home')
  const atlas = el('atlas')
  if (s.view !== 'home' || s.busy || !home || !atlas) return
  s.set({ busy: true, view: 'atlas' })
  go(home, atlas, 'in')
}

/** Settings opens from any view (the gear lives in the titlebar, present everywhere). */
export function openSettings() {
  const s = useUI.getState()
  if (s.busy || s.view === 'settings') return
  const from = el(s.view)
  const settings = el('settings')
  if (!from || !settings) return
  s.set({ busy: true, view: 'settings' })
  go(from, settings, 'in')
}

export function goHome() {
  const s = useUI.getState()
  const home = el('home')
  if (s.view === 'home' || s.busy || !home) return
  const from = el(s.view)
  if (!from) return
  s.set({ busy: true, view: 'home' })
  go(from, home, 'out')
}

/**
 * Transition directly from the current view to any other — used by the inline chat cards to
 * jump straight into Orbit/Atlas. View names double as the DOM ids, so el(target) resolves.
 */
export function navigateTo(target: View, moduleName?: string) {
  const s = useUI.getState()
  if (s.busy || s.view === target) return
  const from = el(s.view)
  const to = el(target)
  if (!from || !to) return
  s.set({ busy: true, view: target, ...(moduleName ? { module: moduleName } : {}) })
  go(from, to, target === 'home' ? 'out' : 'in')
}
