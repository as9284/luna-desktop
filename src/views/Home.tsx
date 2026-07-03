import { useEffect, useRef, useState } from 'react'
import Starfield from '../components/Starfield'
import { openAtlas, openLuna, openModule } from '../lib/router'
import { useChat } from '../store/chat'
import { useSettings } from '../store/settings'
import { CHAT_TEMPERATURE } from '../lib/luna-prompt'
import './home.css'

type Planet = 'orbit' | 'atlas'

const PLANETS: Record<Planet, { name: string; sub: string; aria: string; open: () => void }> = {
  orbit: { name: 'Orbit', sub: 'tasks · notes · projects', aria: 'Orbit — tasks and notes', open: () => openModule('Orbit') },
  atlas: { name: 'Atlas', sub: 'library · reader · research', aria: 'Atlas — research library', open: openAtlas },
}

// Orbital motion is driven in JS (the RAF loop below), not a CSS `animation`. A CSS
// animation restarts from its delay offset every time the view is display:none'd on
// navigation, which snapped the planets back to the start. Time-based JS rotation on a
// loop that runs while home is mounted (always) simply carries on where it was.
// period = ms per revolution; seed = starting angle (matches the old CSS delays).
const ORBIT: Record<Planet, { period: number; seed: number }> = {
  orbit: { period: 150000, seed: (80 / 150) * 360 },
  atlas: { period: 95000, seed: (22 / 95) * 360 },
}

export default function Home() {
  const send = useChat((s) => s.send)
  const streaming = useChat((s) => !!s.streamingByThread[s.activeId])
  const ambient = useSettings((s) => s.ambient)
  const [ask, setAsk] = useState('')

  const [hover, setHover] = useState<Planet | null>(null)

  const parallax = useRef<HTMLDivElement>(null)
  const clock = useRef<HTMLDivElement>(null)
  const date = useRef<HTMLDivElement>(null)
  const planetRefs = useRef<Record<Planet, HTMLSpanElement | null>>({ orbit: null, atlas: null })
  const trackRefs = useRef<Record<Planet, HTMLDivElement | null>>({ orbit: null, atlas: null })
  const uprightRefs = useRef<Record<Planet, HTMLSpanElement | null>>({ orbit: null, atlas: null })
  const angles = useRef<Record<Planet, number>>({ orbit: ORBIT.orbit.seed, atlas: ORBIT.atlas.seed })
  const caption = useRef<HTMLDivElement>(null)
  const hovering = useRef<Planet | null>(null)

  // Anchor the hover caption under the planet with a plain fixed element (measured,
  // never rotated) so it can't tilt with the orbit's counter-rotation animation.
  const placeCaption = () => {
    const which = hovering.current
    const p = which ? planetRefs.current[which] : null
    const c = caption.current
    if (!p || !c) return
    const r = p.getBoundingClientRect()
    c.style.left = `${Math.round(r.left + r.width / 2)}px`
    c.style.top = `${Math.round(r.bottom + 14)}px`
  }

  useEffect(() => {
    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0
    let raf = 0

    const onMove = (e: MouseEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * -16
      ty = (e.clientY / window.innerHeight - 0.5) * -12
    }
    window.addEventListener('mousemove', onMove)

    let last = performance.now()
    const loop = () => {
      const now = performance.now()
      // Clamp dt so a backgrounded window (RAF paused) resumes smoothly instead of
      // jumping. During normal in-app navigation the window stays visible, so the
      // orbits keep advancing in real time and never reset to the start.
      const dt = Math.min(now - last, 50)
      last = now
      const rm = useSettings.getState().reducedMotion

      cx += (tx - cx) * 0.05
      cy += (ty - cy) * 0.05
      if (parallax.current) {
        parallax.current.style.transform = rm ? 'none' : `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`
      }

      for (const id of Object.keys(ORBIT) as Planet[]) {
        // hovering a planet freezes just that orbit (so it doesn't slip from the cursor)
        if (!rm && hovering.current !== id) {
          angles.current[id] = (angles.current[id] + (360 / ORBIT[id].period) * dt) % 360
        }
        const a = angles.current[id]
        trackRefs.current[id]?.style.setProperty('transform', `rotate(${a}deg)`)
        uprightRefs.current[id]?.style.setProperty('transform', `rotate(${-a}deg)`)
      }

      if (hovering.current) placeCaption()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
    const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
    const tick = () => {
      const d = new Date()
      if (clock.current) {
        clock.current.textContent =
          String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
      }
      if (date.current) {
        date.current.textContent =
          DOW[d.getDay()] + ' ' + String(d.getDate()).padStart(2, '0') + ' ' + MON[d.getMonth()]
      }
    }
    tick()
    const iv = window.setInterval(tick, 1000)

    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
      window.clearInterval(iv)
    }
  }, [])

  const submit = () => {
    if (streaming) return
    const t = ask.trim()
    openLuna()
    if (t) {
      setAsk('')
      send(t, { temperature: CHAT_TEMPERATURE })
    }
  }

  return (
    <div className="view stage" id="home">
      <div className="parallax" ref={parallax}>
        {ambient !== 'off' && (
          <Starfield count={ambient === 'subtle' ? 90 : 190} maxOpacity={ambient === 'subtle' ? 0.36 : 0.6} />
        )}
        <div className="vignette" />
        <div className="system">
          <div className="ring ring--inner" />
          <div className="ring ring--outer" />

          {(Object.keys(PLANETS) as Planet[]).map((id) => (
            <div
              key={id}
              className={`track track--${id}`}
              ref={(el) => {
                trackRefs.current[id] = el
                if (el) el.style.transform = `rotate(${angles.current[id]}deg)`
              }}
            >
              <button
                className={`body body--${id}`}
                aria-label={PLANETS[id].aria}
                onClick={PLANETS[id].open}
                onMouseEnter={() => {
                  hovering.current = id
                  placeCaption()
                  setHover(id)
                }}
                onMouseLeave={() => {
                  hovering.current = null
                  setHover(null)
                }}
              >
                <span
                  className="upright"
                  ref={(el) => {
                    uprightRefs.current[id] = el
                    if (el) el.style.transform = `rotate(${-angles.current[id]}deg)`
                  }}
                >
                  <span
                    className={`planet planet--${id}`}
                    ref={(el) => {
                      planetRefs.current[id] = el
                    }}
                  />
                </span>
              </button>
            </div>
          ))}

          <button className="luna" aria-label="Luna" onClick={openLuna} />
          <div className="luna-name">Luna</div>
        </div>
      </div>

      <div className={'orbit-caption' + (hover ? ' show' : '')} ref={caption}>
        <b>{hover ? PLANETS[hover].name : ''}</b>
        <i>{hover ? PLANETS[hover].sub : ''}</i>
      </div>

      <div className="hud hud-tl">
        <div className="t" ref={clock}>
          --:--
        </div>
        <div className="d" ref={date}>
          ———
        </div>
      </div>
      <div className="hud hud-tr">
        <div className="on">online</div>
        <div>2 planets · stable orbit</div>
      </div>

      <div className="dock dock--home">
        <span className="lmark" />
        <input
          placeholder="Ask Luna anything…"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button className="send" aria-label="Send" onClick={submit}>
          <svg viewBox="0 0 16 16">
            <path d="M2 8h11M9 4l4 4-4 4" />
          </svg>
        </button>
      </div>
    </div>
  )
}
