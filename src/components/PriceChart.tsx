import { useEffect, useMemo, useRef } from 'react'
import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import type { Trade } from '../lib/chain'

/** Price from on-chain trades plus the live pool price; in USD when the pair's price is known. */
export default function PriceChart({ trades, current, usd, symbol, quote }: { trades: Trade[]; current: number; usd: number | null; symbol: string; quote: string }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<ISeriesApi<'Area'> | null>(null)
  const mult = usd ?? 1

  useEffect(() => {
    if (!el.current) return
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#6a7596', fontFamily: 'Instrument Sans, sans-serif', attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: '#eef2fa' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#3c5fc455' }, horzLine: { color: '#3c5fc455' } },
    })
    chart.current = c
    series.current = c.addSeries(AreaSeries, {
      lineColor: '#3c5fc4',
      topColor: 'rgba(60,95,196,0.22)',
      bottomColor: 'rgba(60,95,196,0.01)',
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
    <>
      <div className="chart-head">
        <b>
          {symbol} / {usd ? 'USD' : quote}
        </b>
        <span className="muted small">{trades.length ? `${trades.length} recent trades` : 'Live price'}</span>
      </div>
      <div className="chart-canvas">
        <div ref={el} style={{ position: 'absolute', inset: 0 }} />
        {data.length < 2 && <div className="chart-empty">The chart fills in as trades come in.</div>}
      </div>
    </>
  )
}
