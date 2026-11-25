import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCoins } from '../lib/hooks'
import CoinCard from '../components/CoinCard'
import type { Coin } from '../lib/dbc'

type Sort = 'new' | 'mcap' | 'progress'

export default function Board() {
  const { coins, loading, error } = useCoins()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('new')

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    let list = s
      ? coins.filter((c) => c.name.toLowerCase().includes(s) || c.symbol.toLowerCase().includes(s) || c.mint.includes(q.trim()))
      : coins
    const by: Record<Sort, (a: Coin, b: Coin) => number> = {
      new: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      mcap: (a, b) => b.mcapSvx - a.mcapSvx,
      progress: (a, b) => b.progress - a.progress,
    }
    list = [...list].sort(by[sort])
    return {
      fresh: list.filter((c) => c.status === 'new'),
      final: list.filter((c) => c.status === 'final'),
      grad: list.filter((c) => c.status === 'graduated'),
    }
  }, [coins, q, sort])

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>Board</h1>
          <p className="dim">Every coin on Solvex, refreshed every 15 seconds.</p>
        </div>
        <Link to="/launch" className="btn btn-primary">
          + Launch a coin
        </Link>
      </div>

      <div className="toolbar">
        <input className="input" placeholder="Search name, ticker or mint" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {(['new', 'mcap', 'progress'] as Sort[]).map((s) => (
            <button key={s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
              {s === 'new' ? 'Newest' : s === 'mcap' ? 'Market cap' : 'Progress'}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="notice notice-err">Couldn't load coins: {error}</div>}

      <div className="cols cols-board">
        <BoardCol title="New pairs" tag="new" coins={filtered.fresh} loading={loading} />
        <BoardCol title="Final stretch" tag="final" coins={filtered.final} loading={loading} />
        <BoardCol title="Graduated" tag="grad" coins={filtered.grad} loading={loading} />
      </div>
    </div>
  )
}

function BoardCol({ title, tag, coins, loading }: { title: string; tag: string; coins: Coin[]; loading: boolean }) {
  return (
    <div className="col">
      <div className="col-head">
        <span className={`tag tag-${tag}`}>{title}</span>
        <span className="mono dim">{coins.length}</span>
      </div>
      <div className="col-list col-scroll">
        {loading && coins.length === 0 && [0, 1, 2].map((i) => <div key={i} className="coin skeleton" />)}
        {coins.map((c) => (
          <CoinCard key={c.pool} coin={c} />
        ))}
        {!loading && coins.length === 0 && <div className="empty">Nothing here yet.</div>}
      </div>
    </div>
  )
}
