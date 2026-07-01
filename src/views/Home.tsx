import { useEffect, useRef, useState } from 'react'
import Starfield from '../components/Starfield'
import { openLuna, openModule } from '../lib/router'
import { useChat } from '../store/chat'
import { useSettings } from '../store/settings'
import { systemPrompt, tempForMode } from '../lib/luna-prompt'
import './home.css'

export default function Home() {
  const send = useChat((s) => s.send)
  const streaming = useChat((s) => !!s.streamingByThread[s.activeId])
  const mode = useSettings((s) => s.mode)
  const [ask, setAsk] = useState('')

  const [orbitHover, setOrbitHover] = useState(false)

  const parallax = useRef<HTMLDivElement>(null)
  const clock = useRef<HTMLDivElement>(null)
  const date = useRef<HTMLDivElement>(null)
  const planet = useRef<HTMLSpanElement>(null)
  const caption = useRef<HTMLDivElement>(null)
  const hovering = useRef(false)

  // Anchor the hover caption under the planet with a plain fixed element (measured,
  // never rotated) so it can't tilt with the orbit's counter-rotation animation.
  const placeCaption = () => {
    const p = planet.current
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

    const loop = () => {
      cx += (tx - cx) * 0.05
      cy += (ty - cy) * 0.05
      if (parallax.current) {
        parallax.current.style.transform = useSettings.getState().reducedMotion
          ? 'none'
          : `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`
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
      send(t, { temperature: tempForMode(mode), system: systemPrompt() })
    }
  }

  return (
    <div className="view stage" id="home">
      <div className="parallax" ref={parallax}>
        <Starfield count={190} maxOpacity={0.6} />
        <div className="vignette" />
        <div className="system">
          <div className="ring ring--inner" />
          <div className="ring ring--outer" />

          <div className="track track--orbit">
            <button
              className="body body--orbit"
              aria-label="Orbit — tasks and notes"
              onClick={() => openModule('Orbit')}
              onMouseEnter={() => {
                hovering.current = true
                placeCaption()
                setOrbitHover(true)
              }}
              onMouseLeave={() => {
                hovering.current = false
                setOrbitHover(false)
              }}
            >
              <span className="upright">
                <span className="planet planet--orbit" ref={planet} />
              </span>
            </button>
          </div>

          <button className="luna" aria-label="Luna" onClick={openLuna} />
          <div className="luna-name">Luna</div>
        </div>
      </div>

      <div className={'orbit-caption' + (orbitHover ? ' show' : '')} ref={caption}>
        <b>Orbit</b>
        <i>tasks · notes · projects</i>
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
        <div>1 planet · stable orbit</div>
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
