import { useEffect, useMemo, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { fetchPairMints } from '../lib/chain'
import { Link } from 'react-router-dom'
import { useAssets } from '../lib/hooks'
import { AssetIcon } from '../components/Bits'
import { short } from '../lib/format'

const PAGE = 24

export default function Stocks() {
  const { assets, error } = useAssets()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const { connection } = useConnection()
  const [supported, setSupported] = useState<Set<string> | null>(null)
  useEffect(() => {
    fetchPairMints(connection).then(setSupported).catch(() => setSupported(new Set()))
  }, [connection])
  // only stocks pump.fun accepts as a pair for new coins
  const stocks = useMemo(() => {
    const s = q.trim().toLowerCase()
    return assets.filter((a) => a.category === 'stock' && supported?.has(a.mint) && (!s || `${a.symbol} ${a.name}`.toLowerCase().includes(s)))
  }, [assets, q, supported])
  const pages = Math.max(1, Math.ceil(stocks.length / PAGE))

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>Stock pairs</h1>
          <p>Launch a pump.fun coin priced in a tokenized stock or ETF. Only the stocks pump.fun accepts as pairs are listed.</p>
        </div>
        <label className="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input className="input" placeholder="Search stocks and ETFs" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} aria-label="Search stocks" />
        </label>
      </div>

      <div className="note" style={{ marginBottom: 18 }}>
        These are tokenized assets issued by xStocks, not brokerage shares. A stock pair is the currency traders use to buy your coin; it doesn’t mean your coin is
        backed by the stock. Issuer terms and regional restrictions apply.{' '}
        <a href="https://assets.backed.fi/legal-documentation" target="_blank" rel="noreferrer">
          Read the issuer terms
        </a>
      </div>
      {error && <div className="err" style={{ marginBottom: 18 }}>{error}</div>}

      {stocks.length ? (
        <>
          <div className="stock-grid">
            {stocks.slice(page * PAGE, (page + 1) * PAGE).map((a) => (
              <div className="surface stock" key={a.mint}>
                <div className="stock-top">
                  <AssetIcon asset={a} size={40} />
                  <div>
                    <b>{a.symbol}</b>
                    <small>{a.name}</small>
                  </div>
                </div>
                <span className="muted small">{short(a.mint, 6)}</span>
                {a.halted ? (
                  <span className="badge">Halted by issuer</span>
                ) : (
                  <Link className="btn btn-ghost btn-sm" to={`/launch?pair=${a.mint}`}>
                    Launch a coin paired with {a.symbol}
                  </Link>
                )}
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="pager">
              <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>
                Page {page + 1} of {pages}
              </span>
              <button className="btn btn-ghost btn-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="surface empty">
          <h3>{q ? 'No stock matches that search' : supported && supported.size ? 'Loading the stock catalogue' : supported ? 'pump.fun isn’t accepting stock pairs right now' : 'Loading the stock pairs pump.fun accepts'}</h3>
          <p>{q ? 'Try a ticker like NVDAx or TSLAx.' : 'Reading tokenized stocks from the xStocks issuer.'}</p>
        </div>
      )}
    </div>
  )
}
