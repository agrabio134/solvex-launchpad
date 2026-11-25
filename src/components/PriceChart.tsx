import { useMemo, useState } from 'react'
import type { Trade } from '../lib/dbc'
import { price as fmtPrice } from '../lib/format'

/** Price over time built from on-chain trades (oldest → newest), ending at the live curve price. */
export default function PriceChart({ trades, current }: { trades: Trade[]; current: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 800
  const H = 260
  const P = 8

  const pts = useMemo(() => {
    const t = [...trades].filter((x) => x.price > 0).sort((a, b) => a.time - b.time)
    const now = Math.floor(Date.now() / 1000)
    const series = t.map((x) => ({ t: x.time, p: x.price, side: x.side }))
    if (current > 0) series.push({ t: Math.max(now, series.at(-1)?.t ?? now), p: current, side: 'buy' as const })
    return series
  }, [trades, current])

  if (pts.length < 2)
    return <div className="chart-empty dim small">The chart fills in as trades come in.</div>

  const minT = pts[0].t
  const maxT = pts[pts.length - 1].t || minT + 1
  const ps = pts.map((p) => p.p)
  const lo = Math.min(...ps)
  const hi = Math.max(...ps)
  const pad = (hi - lo) * 0.12 || hi * 0.1
  const y = (p: number) => H - P - ((p - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 2 * P)
  const x = (t: number) => P + ((t - minT) / Math.max(1, maxT - minT)) * (W - 2 * P)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join(' ')
  const area = `${line} L${x(maxT).toFixed(1)},${H} L${x(minT).toFixed(1)},${H} Z`
  const up = pts[pts.length - 1].p >= pts[0].p
  const change = (pts[pts.length - 1].p / pts[0].p - 1) * 100
  const h = hover !== null ? pts[hover] : null

  return (
    <div className="chart">
      <div className="chart-top mono small">
        <span>{h ? `${fmtPrice(h.p)} SVX` : `${fmtPrice(current)} SVX`}</span>
        <span className={up ? 'up' : 'down'}>
          {up ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% over last {pts.length - 1} trades
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const t = minT + ((e.clientX - r.left) / r.width) * (maxT - minT)
          let best = 0
          pts.forEach((p, i) => Math.abs(p.t - t) < Math.abs(pts[best].t - t) && (best = i))
          setHover(best)
        }}
      >
        <defs>
          <linearGradient id="cg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={up ? 'var(--accent)' : 'var(--red)'} stopOpacity="0.35" />
            <stop offset="100%" stopColor={up ? 'var(--accent)' : 'var(--red)'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#cg)" />
        <path d={line} fill="none" stroke={up ? 'var(--accent)' : 'var(--red)'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {h && (
          <>
            <line x1={x(h.t)} x2={x(h.t)} y1={0} y2={H} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
            <circle cx={x(h.t)} cy={y(h.p)} r="4" fill={h.side === 'buy' ? 'var(--mint)' : 'var(--red)'} />
          </>
        )}
      </svg>
    </div>
  )
}
