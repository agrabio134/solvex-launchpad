import { useEffect, useMemo, useRef, useState } from 'react'
import { AreaSeries, CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import type { Trade } from '../lib/chain'
import { price as fmtPrice } from '../lib/format'

const FRAMES = [
  ['1m', 60],
  ['5m', 300],
  ['15m', 900],
  ['1h', 3600],
] as const
const SUPPLY = 1_000_000_000
// 4 significant digits, so nearby axis labels stay distinct ($2.003K, $2.010K)
const axisCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 4 })

/**
 * Candles built from pump.fun trade events (each trade's curve price before and after),
 * with the live curve price as the latest close. In USD when the pair's price is known.
 */
export default function PriceChart({ trades, current, usd, symbol, quote }: { trades: Trade[]; current: number; usd: number | null; symbol: string; quote: string }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const candles = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const line = useRef<ISeriesApi<'Area'> | null>(null)
  const volume = useRef<ISeriesApi<'Histogram'> | null>(null)
  const [frame, setFrame] = useState<number>(60)
  const [mode, setMode] = useState<'mcap' | 'price'>('mcap')
  const [style, setStyle] = useState<'line' | 'candles'>(() => {
    try {
      return localStorage.getItem('flip-chart-style') === 'candles' ? 'candles' : 'line'
    } catch {
      return 'line'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('flip-chart-style', style)
    } catch {
      /* storage unavailable */
    }
    candles.current?.applyOptions({ visible: style === 'candles' })
    line.current?.applyOptions({ visible: style === 'line' })
  }, [style])
  const mult = (usd ?? 1) * (mode === 'mcap' ? SUPPLY : 1)
  const unit = usd ? '$' : ''
  const fmt = (v: number) => (mode === 'mcap' ? `${unit}${axisCompact.format(v)}` : `${unit}${fmtPrice(v)}`)

  useEffect(() => {
    if (!el.current) return
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#6a7596', fontFamily: 'Instrument Sans, sans-serif', fontSize: 12, attributionLogo: false },
      grid: { vertLines: { color: '#f2f5fb' }, horzLines: { color: '#f2f5fb' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 12, minBarSpacing: 3 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#3c5fc455', labelBackgroundColor: '#3c5fc4' }, horzLine: { color: '#3c5fc455', labelBackgroundColor: '#3c5fc4' } },
    })
    chart.current = c
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: '#11975a',
      downColor: '#d63b4e',
      borderUpColor: '#11975a',
      borderDownColor: '#d63b4e',
      wickUpColor: '#11975a',
      wickDownColor: '#d63b4e',
      priceLineColor: '#3c5fc4',
    })
    line.current = c.addSeries(AreaSeries, {
      lineColor: '#3c5fc4',
      topColor: 'rgba(60,95,196,0.20)',
      bottomColor: 'rgba(60,95,196,0.01)',
      lineWidth: 2,
      lineType: 0,
      crosshairMarkerRadius: 4,
      priceLineColor: '#3c5fc4',
    })
    candles.current.applyOptions({ visible: style === 'candles' })
    line.current.applyOptions({ visible: style === 'line' })
    volume.current = c.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    return () => {
      c.remove()
      chart.current = null
      candles.current = null
      line.current = null
      volume.current = null
    }
  }, [])

  useEffect(() => {
    candles.current?.applyOptions({ priceFormat: { type: 'custom', formatter: fmt, minMove: 1e-12 } })
    line.current?.applyOptions({ priceFormat: { type: 'custom', formatter: fmt, minMove: 1e-12 } })
  }, [mode, usd])

  const { bars, vols, change, points } = useMemo(() => {
    const list = [...trades].filter((t) => t.price > 0 && t.time > 0).sort((a, b) => a.time - b.time)
    const byTime = new Map<number, number>()
    if (list[0]) byTime.set(list[0].time - 1, list[0].pre)
    list.forEach((t) => byTime.set(t.time, t.price))
    if (current > 0) byTime.set(Math.max(Math.floor(Date.now() / 1000), ...[...byTime.keys()].map((k) => k + 1)), current)
    const map = new Map<number, { open: number; high: number; low: number; close: number; vol: number }>()
    let last: number | null = null
    for (const t of list) {
      const b = Math.floor(t.time / frame) * frame
      const open = last ?? t.pre
      const bar = map.get(b) ?? { open, high: open, low: open, close: open, vol: 0 }
      bar.high = Math.max(bar.high, t.pre, t.price)
      bar.low = Math.min(bar.low, t.pre, t.price)
      bar.close = t.price
      bar.vol += t.svx
      map.set(b, bar)
      last = t.price
    }
    // live curve price closes the current candle
    if (current > 0) {
      const b = Math.floor(Date.now() / 1000 / frame) * frame
      const open = last ?? current
      const bar = map.get(b) ?? { open, high: open, low: open, close: open, vol: 0 }
      bar.high = Math.max(bar.high, current)
      bar.low = Math.min(bar.low, current)
      bar.close = current
      map.set(b, bar)
    }
    const keys = [...map.keys()].sort((a, b) => a - b)
    const first = list[0]?.pre ?? current
    return {
      bars: keys.map((k) => {
        const v = map.get(k)!
        return { time: k as UTCTimestamp, open: v.open * mult, high: v.high * mult, low: v.low * mult, close: v.close * mult }
      }),
      vols: keys.map((k) => {
        const v = map.get(k)!
        return { time: k as UTCTimestamp, value: v.vol * (usd ?? 1), color: v.close >= v.open ? 'rgba(17,151,90,0.28)' : 'rgba(214,59,78,0.28)' }
      }),
      change: first > 0 && current > 0 ? (current / first - 1) * 100 : null,
      points: [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ time: t as UTCTimestamp, value: v * mult })),
    }
  }, [trades, current, mult, frame, usd])

  useEffect(() => {
    candles.current?.setData(bars)
    line.current?.setData(points)
    volume.current?.setData(style === 'candles' ? vols : [])
    if (style === 'line') chart.current?.timeScale().fitContent()
    else if (bars.length) chart.current?.timeScale().scrollToRealTime()
  }, [bars, vols, points, style])

  // candles: fixed width (no stretching when there are only a few), pinned to the latest
  useEffect(() => {
    if (style !== 'candles') return
    chart.current?.timeScale().applyOptions({ barSpacing: 12 })
    chart.current?.timeScale().scrollToRealTime()
  }, [frame, mode, style])

  const now = current * mult
  return (
    <>
      <div className="chart-head">
        <div className="chart-title">
          <span className="muted small">
            {symbol} / {usd ? 'USD' : quote} · {mode === 'mcap' ? 'market cap' : 'price'}
          </span>
          <b>
            {current > 0 ? fmt(now) : '—'}
            {change !== null && <em className={change >= 0 ? 'up' : 'down'}>{`${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}</em>}
          </b>
        </div>
        <div className="chart-tools">
          <span className="slip">
            <button className={style === 'line' ? 'on' : ''} onClick={() => setStyle('line')}>
              Line
            </button>
            <button className={style === 'candles' ? 'on' : ''} onClick={() => setStyle('candles')}>
              Candles
            </button>
          </span>
          <span className="slip">
            <button className={mode === 'mcap' ? 'on' : ''} onClick={() => setMode('mcap')}>
              MCap
            </button>
            <button className={mode === 'price' ? 'on' : ''} onClick={() => setMode('price')}>
              Price
            </button>
          </span>
          {style === 'candles' && (
          <span className="slip">
            {FRAMES.map(([l, s]) => (
              <button key={l} className={frame === s ? 'on' : ''} onClick={() => setFrame(s)}>
                {l}
              </button>
            ))}
          </span>
          )}
        </div>
      </div>
      <div className="chart-canvas">
        <div ref={el} style={{ position: 'absolute', inset: 0 }} />
        {!trades.length && <div className="chart-empty">Candles appear with the first trade.</div>}
      </div>
    </>
  )
}
