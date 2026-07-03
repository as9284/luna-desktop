import { memo, useRef, useState } from 'react'
import { clearMarks } from './helpers'

/** 0-based column index → spreadsheet letter (A, B, … Z, AA). */
function colLetter(i: number): string {
  let s = ''
  i += 1
  while (i > 0) {
    const r = (i - 1) % 26
    s = String.fromCharCode(65 + r) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

/** Renders a spreadsheet as a real grid: sheet tabs, column/row headers, merged cells, widths,
 *  and the cell styles (bold, alignment, text/fill colour) carried over from the workbook. */
const SheetView = memo(function SheetView({ sheets, truncated }: { sheets: DocSheet[]; truncated: boolean }) {
  const [active, setActive] = useState(0)
  const hostRef = useRef<HTMLDivElement>(null)
  const sheet = sheets[active]
  if (!sheet) return <div className="doc-empty">This workbook has no readable sheets.</div>

  // clear any find highlights before swapping sheets so React never reconciles against our <mark>s
  const switchTo = (i: number) => {
    if (hostRef.current) clearMarks(hostRef.current)
    setActive(i)
  }

  return (
    <div className="sheet-host" ref={hostRef}>
      {sheets.length > 1 && (
        <div className="sheet-tabs">
          {sheets.map((s, i) => (
            <button key={i} className={'sheet-tab' + (i === active ? ' on' : '')} onClick={() => switchTo(i)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="sheet-scroll scroll-y">
        <table className="sheet-grid">
          <colgroup>
            <col style={{ width: 44 }} />
            {sheet.colWidths.map((w, i) => (
              <col key={i} style={{ width: Math.max(40, Math.min(w, 480)) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sheet-corner" />
              {sheet.colWidths.map((_, c) => (
                <th key={c} className="sheet-colhead">
                  {colLetter(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                <th className="sheet-rowhead">{r + 1}</th>
                {row.map((cell, c) =>
                  cell.hidden ? null : (
                    <td
                      key={c}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      style={{
                        fontWeight: cell.bold ? 600 : undefined,
                        fontStyle: cell.italic ? 'italic' : undefined,
                        textAlign: cell.align,
                        color: cell.color,
                        background: cell.bg,
                      }}
                    >
                      {cell.v}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && <div className="doc-note">Large workbook — showing the first part of each sheet.</div>}
    </div>
  )
})

export default SheetView
