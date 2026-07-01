import { useMemo } from 'react'
import type { CSSProperties } from 'react'

interface Props {
  count?: number
  maxOpacity?: number
  className?: string
}

export default function Starfield({ count = 190, maxOpacity = 0.6, className = 'starfield' }: Props) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: `${(Math.random() * 100).toFixed(2)}%`,
        top: `${(Math.random() * 100).toFixed(2)}%`,
        size: Math.random() < 0.85 ? 1 : 2,
        op: Number((Math.random() * maxOpacity + 0.12).toFixed(2)),
        tw: `${(Math.random() * 4 + 2.5).toFixed(1)}s`,
        delay: `-${(Math.random() * 5).toFixed(1)}s`,
      })),
    [count, maxOpacity],
  )

  return (
    <div className={className}>
      {stars.map((s, i) => (
        <span
          key={i}
          className="star"
          style={
            {
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              opacity: s.op,
              animationDelay: s.delay,
              '--tw': s.tw,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
