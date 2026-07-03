/** Read an SSE response body line-by-line, handing each `data:` payload to `onData`. */
export async function readEventStream(res: Response, onData: (data: string) => void): Promise<void> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const emit = (line: string) => {
    const l = line.trim()
    if (!l.startsWith('data:')) return
    const data = l.slice(5).trim()
    if (data) onData(data)
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) emit(line)
  }
  // flush any trailing frame that wasn't newline-terminated (some non-standard endpoints)
  if (buf.trim()) emit(buf)
}
