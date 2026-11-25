import { useEffect, useMemo, useRef } from 'react'
import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import type { Trade } from '../lib/dbc'
import { Q } from '../lib/config'

/**
 * Price line from on-chain trades plus the live pool price.
 * Shown in USD when the $FLIP price is known, otherwise in FLIP.
 */
export default function PriceChart({ trades, current, usd, symbol }: { trades: Trade[]; current: number; usd: number | null; symbol: string }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<ISeriesApi<'Area'> | null>(null)
  const mult = usd ?? 1

  useEffect(() => {
    if (!el.current) return
    const c = createChart(el.current, {
      autoSize: true,
      height: 300,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#716a5e', fontFamily: 'IBM Plex Mono, monospace', attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: '#efebe3' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#3b62d055' }, horzLine: { color: '#3b62d055' } },
    })
    chart.current = c
    series.current = c.addSeries(AreaSeries, {
      lineColor: '#3b62d0',
      topColor: 'rgba(59,98,208,0.25)',
      bottomColor: 'rgba(59,98,208,0.02)',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 10, minMove: 0.0000000001 },
    })
    return () => {
      c.remove()
      chart.current = null
      series.current = null
    }
  }, [])

  const data = useMemo(() => {
    const byTime = new Map<number, number>()
    ;[...trades]
      .filter((t) => t.price > 0 && t.time > 0)
      .sort((a, b) => a.time - b.time)
      .forEach((t) => byTime.set(t.time, t.price * mult))
    if (current > 0) {
      const now = Math.floor(Date.now() / 1000)
      const last = Math.max(0, ...byTime.keys())
      byTime.set(Math.max(now, last + 1), current * mult)
    }
    return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value }))
  }, [trades, current, mult])

  useEffect(() => {
    series.current?.setData(data)
    chart.current?.timeScale().fitContent()
  }, [data])

  return (
    <div className="chart">
      <div className="chart-top mono small">
        <span>
          {symbol} / {usd ? 'USD' : Q}
        </span>
        <span className="dim">{trades.length} recent trades</span>
      </div>
      <div ref={el} className="chart-canvas" />
      {data.length < 2 && <div className="chart-empty dim small">The chart fills in as trades come in.</div>}
    </div>
  )
}
