import { useEffect, useState } from 'react'

export interface DocBytes {
  bytes: Uint8Array
  mime: string
  fileType?: string
}

interface State {
  data: DocBytes | null
  url: string | null // object URL for <img>/<embed>; revoked on cleanup
  loading: boolean
  error: string | null
}

/** Pull a vaulted file's bytes into the renderer, exposing both the raw bytes (for pdf.js /
 *  docx-preview) and a blob object URL (for <img>). Revokes the URL on unmount / id change. */
export function useBytes(id: string, enabled: boolean): State {
  const [state, setState] = useState<State>({ data: null, url: null, loading: enabled, error: null })

  useEffect(() => {
    if (!enabled) return
    let url: string | null = null
    let alive = true
    setState({ data: null, url: null, loading: true, error: null })
    ;(async () => {
      try {
        const res = await window.api?.atlas.fileBytes(id)
        if (!alive) return
        if (!res?.ok || !res.bytes) {
          setState({ data: null, url: null, loading: false, error: res?.error ?? 'Could not load the file.' })
          return
        }
        const bytes = res.bytes instanceof Uint8Array ? res.bytes : new Uint8Array(res.bytes as ArrayBuffer)
        url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: res.mime || 'application/octet-stream' }))
        setState({ data: { bytes, mime: res.mime ?? '', fileType: res.fileType }, url, loading: false, error: null })
      } catch (e) {
        if (alive) setState({ data: null, url: null, loading: false, error: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [id, enabled])

  return state
}
