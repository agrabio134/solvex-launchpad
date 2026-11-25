import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAssets, useCoins, useUsdMany } from '../lib/hooks'
import { MarketHead, MarketRow } from '../components/Bits'

const FILTERS = [
  ['all', 'All'],
  ['new', 'New'],
  ['final', 'Final stretch'],
  ['graduated', 'Graduated'],
  ['stocks', 'Stock pairs'],
] as const
type Filter = (typeof FILTERS)[number][0]
type Sort = 'new' | 'mcap' | 'progress'

export default function Markets() {
  const { coins, loading, error, reload } = useCoins(15000)
  const { find } = useAssets()
  const prices = useUsdMany(coins.map((c) => c.quoteMint))
  const [params, setParams] = useSearchParams()
  const filter = (params.get('f') as Filter) || 'all'
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('new')

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const usdCap = (m: (typeof coins)[number]) => m.mcapSvx * (prices[m.quoteMint] ?? 0)
    return coins
      .filter((c) => {
        if (filter === 'new') return c.status === 'new'
        if (filter === 'final') return c.status === 'final'
        if (filter === 'graduated') return c.complete || c.migrated
        if (filter === 'stocks') return find(c.quoteMint)?.category === 'stock'
        return true
      })
      .filter((c) => !s || `${c.name} ${c.symbol} ${c.mint}`.toLowerCase().includes(s))
      .sort((a, b) => (sort === 'mcap' ? usdCap(b) - usdCap(a) : sort === 'progress' ? b.progress - a.progress : (b.createdAt ?? 0) - (a.createdAt ?? 0)))
  }, [coins, filter, q, sort, prices, find])

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>Markets</h1>
          <p>Every coin launched on Solvex, read live from Solana.</p>
        </div>
        <Link to="/launch" className="btn btn-primary">
          Launch a coin
        </Link>
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist">
          {FILTERS.map(([v, l]) => (
            <button key={v} className={filter === v ? 'on' : ''} onClick={() => setParams(v === 'all' ? {} : { f: v })}>
              {l}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label className="search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input className="input" placeholder="Search name, ticker or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
          </label>
          <div className="seg">
            {(['new', 'mcap', 'progress'] as Sort[]).map((s) => (
              <button key={s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
                {s === 'new' ? 'Newest' : s === 'mcap' ? 'Market cap' : 'Progress'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="surface market-table">
        <MarketHead />
        {error ? (
          <div className="empty">
            <h3>Couldn’t read markets from Solana</h3>
            <p>{error}</p>
            <button className="btn btn-ghost" onClick={reload}>
              Try again
            </button>
          </div>
        ) : loading && !coins.length ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 58, margin: '10px 20px' }} />)
        ) : list.length ? (
          list.map((c) => <MarketRow key={c.pool} coin={c} price={prices[c.quoteMint]} />)
        ) : (
          <div className="empty">
            <h3>{coins.length ? 'Nothing matches' : 'No markets yet'}</h3>
            <p>{coins.length ? 'Try another filter or search.' : 'Launch the first coin on Solvex. It takes one transaction.'}</p>
            {!coins.length && (
              <Link to="/launch" className="btn btn-primary">
                Launch a coin
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
