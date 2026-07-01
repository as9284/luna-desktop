import { useEffect, useState } from 'react'
import { Button } from '../ui'
import './updater.css'

type State =
  | { k: 'idle' }
  | { k: 'available'; version: string }
  | { k: 'downloading'; pct: number }
  | { k: 'downloaded'; version: string }

export default function Updater() {
  const [st, setSt] = useState<State>({ k: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const api = window.api?.updates
    if (!api) return
    return api.onEvent((e) => {
      if (e.type === 'available') {
        setSt({ k: 'available', version: e.payload.version })
        setDismissed(false)
      } else if (e.type === 'progress') {
        setSt({ k: 'downloading', pct: e.payload })
      } else if (e.type === 'downloaded') {
        setSt({ k: 'downloaded', version: e.payload.version })
        setDismissed(false)
      }
      // 'checking' / 'none' / 'error' carry no persistent UI here
    })
  }, [])

  if (st.k === 'idle' || dismissed) return null

  const download = () => {
    setSt({ k: 'downloading', pct: 0 })
    window.api?.updates.download()
  }
  const install = () => window.api?.updates.install()

  return (
    <div className="updater" role="status">
      {st.k === 'available' && (
        <>
          <div className="updater-txt">
            <b>Update available</b>
            <span>Version {st.version} is ready to download.</span>
          </div>
          <div className="updater-actions">
            <Button variant="ghost" small onClick={() => setDismissed(true)}>
              Later
            </Button>
            <Button variant="primary" small onClick={download}>
              Download
            </Button>
          </div>
        </>
      )}

      {st.k === 'downloading' && (
        <div className="updater-txt">
          <b>Downloading update</b>
          <span>{st.pct}%</span>
          <div className="updater-bar">
            <i style={{ width: `${st.pct}%` }} />
          </div>
        </div>
      )}

      {st.k === 'downloaded' && (
        <>
          <div className="updater-txt">
            <b>Update ready</b>
            <span>Version {st.version} installs on restart.</span>
          </div>
          <div className="updater-actions">
            <Button variant="ghost" small onClick={() => setDismissed(true)}>
              Later
            </Button>
            <Button variant="primary" small onClick={install}>
              Restart now
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
