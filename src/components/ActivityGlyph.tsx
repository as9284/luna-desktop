/**
 * The characterful-monochrome glyph for one kind of work Luna does. Pure SVG (currentColor +
 * transform/opacity animations in activity.css); motion only runs inside a `.astep--running`
 * row, so finished/saved steps render as a still glyph. See src/components/activity.css.
 */

import type { ReactElement } from 'react'

type Kind = LunaStepKind

const GLYPHS: Record<Kind, ReactElement> = {
  search: (
    <g className="a-search">
      <circle cx="10" cy="10" r="6" />
      <line x1="14.5" y1="14.5" x2="20" y2="20" />
      <circle className="scan" cx="10" cy="10" r="1.3" fill="currentColor" stroke="none" />
    </g>
  ),
  web: (
    <g className="a-web">
      <circle cx="12" cy="12" r="8" />
      <ellipse className="lat" cx="12" cy="12" rx="8" ry="3.4" />
      <line x1="12" y1="4" x2="12" y2="20" />
      <circle className="ping" cx="20" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </g>
  ),
  read: (
    <g className="a-read">
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <line className="ln" x1="8" y1="8" x2="16" y2="8" />
      <line className="ln" x1="8" y1="11.5" x2="16" y2="11.5" />
      <line className="ln" x1="8" y1="15" x2="14" y2="15" />
    </g>
  ),
  browse: (
    <g>
      <rect className="file" x="8" y="6" width="8" height="6" rx="1" />
      <path className="flap" d="M3 9 h6 l2 2 h9 a1 1 0 0 1 1 1 v6 a1 1 0 0 1 -1 1 H4 a1 1 0 0 1 -1 -1 Z" />
    </g>
  ),
  image: (
    <g className="a-image">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="12" cy="12" r="3.4" />
      <line className="scanl" x1="5.5" y1="12" x2="18.5" y2="12" strokeWidth="1.2" opacity="0.9" />
    </g>
  ),
  write: (
    <g>
      <path className="pen" d="M4 18 l9 -9 l3 3 l-9 9 h-3 Z" />
      <path className="stroke" d="M4 20.5 h16" />
    </g>
  ),
  pdf: (
    <g>
      <path d="M7 3.5 h6 l4 4 v13 a1 1 0 0 1 -1 1 H7 a1 1 0 0 1 -1 -1 V4.5 a1 1 0 0 1 1 -1 Z" />
      <path d="M13 3.5 v4 h4" />
      <g className="arw">
        <line x1="11.5" y1="12.5" x2="11.5" y2="17.5" />
        <path d="M9.5 15.5 l2 2 l2 -2" />
      </g>
    </g>
  ),
  code: (
    <g>
      <path className="lb" d="M8.5 8 L4.5 12 L8.5 16" />
      <path className="rb" d="M15.5 8 L19.5 12 L15.5 16" />
      <line className="caret" x1="12" y1="8.5" x2="12" y2="15.5" strokeWidth="1.4" />
    </g>
  ),
  delete: (
    <g className="a-del">
      <path d="M6 7 h12 l-1 13 a1 1 0 0 1 -1 1 H8 a1 1 0 0 1 -1 -1 Z" />
      <path d="M9.5 7 V5 a1 1 0 0 1 1 -1 h3 a1 1 0 0 1 1 1 v2" />
      <line className="ln" x1="10" y1="11" x2="10" y2="17" />
      <line className="ln" x1="14" y1="11" x2="14" y2="17" />
    </g>
  ),
  save: (
    <g>
      <path className="item" d="M12 4 v6 M9.5 8 l2.5 2.5 l2.5 -2.5" />
      <path className="tray" d="M5 13 v4 a1 1 0 0 0 1 1 h12 a1 1 0 0 0 1 -1 v-4" />
    </g>
  ),
  highlight: (
    <g>
      <rect className="band" x="5" y="15" width="14" height="3.4" rx="1" fill="rgba(var(--accent-rgb), 0.18)" stroke="none" />
      <g className="marker">
        <path d="M8 13 l4 -8 l3 1.6 l-3.5 8 Z" />
        <line x1="8.5" y1="13" x2="11.5" y2="14.6" />
      </g>
    </g>
  ),
  task: (
    <g>
      <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" />
      <path className="chk" d="M8 12.2 l2.6 2.8 L16 8.5" />
    </g>
  ),
  note: (
    <g className="a-note">
      <path d="M6 3.5 h9 l4 4 v13 a1 1 0 0 1 -1 1 H6 a1 1 0 0 1 -1 -1 V4.5 a1 1 0 0 1 1 -1 Z" />
      <path d="M15 3.5 v4 h4" />
      <line className="w" x1="8.5" y1="12" x2="15.5" y2="12" />
      <line className="w" x1="8.5" y1="15.5" x2="13.5" y2="15.5" />
    </g>
  ),
  project: (
    <g>
      <circle cx="12" cy="12" r="8.6" opacity="0.18" />
      <circle className="arc" cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </g>
  ),
  skill: (
    <g>
      <path className="a-skill" d="M12 3.5 l2.2 5.8 l5.8 2.2 l-5.8 2.2 l-2.2 5.8 l-2.2 -5.8 l-5.8 -2.2 l5.8 -2.2 Z" />
      <circle className="s2" cx="18" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    </g>
  ),
  memory: (
    <g className="a-mem">
      <circle className="ring" cx="12" cy="12" r="7.5" />
      <circle className="dot" cx="12" cy="12" r="2.3" fill="currentColor" stroke="none" />
    </g>
  ),
  think: (
    <g className="a-think">
      <circle className="core" cx="12" cy="12" r="4" fill="rgba(var(--accent-rgb), 0.14)" />
      <circle cx="12" cy="12" r="7.5" opacity="0.4" />
      <circle className="d1" cx="8.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle className="d2" cx="15.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </g>
  ),
}

export function ActivityGlyph({ kind }: { kind: Kind }) {
  return (
    <svg className={`aglyph aglyph--${kind}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[kind] ?? GLYPHS.think}
    </svg>
  )
}

/** the little tick that draws in when a step finishes */
export function TickGlyph() {
  return (
    <svg className="atick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5 l4 4 L19 7" />
    </svg>
  )
}
