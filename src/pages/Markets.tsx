import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAssets, useCoins, useUsdMany } from '../lib/hooks'
import { MarketCard, MarketHead, MarketRow, TopCoin } from '../components/Bits'

const FILTERS = [
  ['all', 'All'],
  ['new', 'New Pairs'],
  ['final', 'Final stretch'],
  ['graduated', 'Graduated'],
  ['stocks', 'Stock pairs'],
] as const
type Filter = (typeof FILTERS)[number][0]
type Sort = 'new' | 'mcap' | 'progress'

export default function Markets() {
  const { coins, loading, error, reload } = useCoins(10000)
  const { find } = useAssets()
  const prices = useUsdMany(coins.map((c) => c.quoteMint))
  const [params, setParams] = useSearchParams()
  const filter = (params.get('f') as Filter) || 'all'
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('new')
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem('flip-markets-view') === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('flip-markets-view', view)
    } catch {
      /* storage unavailable */
    }
  }, [view])
  const counts = useMemo(
    () => ({
      all: coins.length,
      new: coins.filter((c) => c.status === 'new').length,
      final: coins.filter((c) => c.status === 'final').length,
      graduated: coins.filter((c) => c.complete).length,
      stocks: coins.filter((c) => find(c.quoteMint)?.category === 'stock').length,
    }),
    [coins, find],
  )

  // the coin with the highest market cap (in USD) is pinned above the list on the All tab
  const top = useMemo(() => {
    const cap = (c: (typeof coins)[number]) => c.mcapSvx * (prices[c.quoteMint] ?? 0)
    return coins.length ? [...coins].sort((a, b) => cap(b) - cap(a))[0] : null
  }, [coins, prices])
  const showTop = !!top && filter === 'all' && !q.trim()

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
      .filter((c) => !(filter === 'all' && !s && top && c.mint === top.mint))
      .sort((a, b) => (sort === 'mcap' ? usdCap(b) - usdCap(a) : sort === 'progress' ? b.progress - a.progress : (b.createdAt ?? 0) - (a.createdAt ?? 0)))
  }, [coins, filter, q, sort, prices, find, top])

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>Markets</h1>
          <p>Every coin launched on Flip, read live from Solana.</p>
        </div>
        <Link to="/launch" className="btn btn-primary">
          Launch a coin
        </Link>
      </div>

      <div className="mk-bar">
        <div className="seg" role="tablist">
          {FILTERS.map(([v, l]) => (
            <button key={v} role="tab" aria-selected={filter === v} className={filter === v ? 'on' : ''} onClick={() => setParams(v === 'all' ? {} : { f: v })}>
              {l}
              <i className="count">{counts[v]}</i>
            </button>
          ))}
        </div>
        <div className="mk-tools">
          <label className="search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input className="input" placeholder="Search name, ticker or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
          </label>
          <label className="sort">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort markets">
              <option value="new">Newest</option>
              <option value="mcap">Market cap</option>
              <option value="progress">Bonding progress</option>
            </select>
          </label>
          <div className="viewtoggle" role="group" aria-label="Layout">
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-label="Card view" title="Card view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="3" y="3" width="8" height="8" rx="2" />
                <rect x="13" y="3" width="8" height="8" rx="2" />
                <rect x="3" y="13" width="8" height="8" rx="2" />
                <rect x="13" y="13" width="8" height="8" rx="2" />
              </svg>
            </button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="List view" title="List view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="3" y="4" width="18" height="4" rx="1.5" />
                <rect x="3" y="10" width="18" height="4" rx="1.5" />
                <rect x="3" y="16" width="18" height="4" rx="1.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {showTop && top && <TopCoin coin={top} price={prices[top.quoteMint]} />}

      {showTop && !error && list.length === 0 ? null : view === 'grid' && !error && list.length > 0 ? (
        <div className="mgrid">
          {list.map((c) => (
            <MarketCard key={c.pool} coin={c} price={prices[c.quoteMint]} />
          ))}
        </div>
      ) : view === 'grid' && !error && loading && !coins.length ? (
        <div className="mgrid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton" style={{ height: 196, borderRadius: 'var(--r-lg)' }} />
          ))}
        </div>
      ) : (
      <div className="surface market-table">
        {view === 'list' && <MarketHead />}
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
            <p>{coins.length ? 'Try another filter or search.' : 'Launch the first coin on Flip. It takes one transaction.'}</p>
            {!coins.length && (
              <Link to="/launch" className="btn btn-primary">
                Launch a coin
              </Link>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  )
}
