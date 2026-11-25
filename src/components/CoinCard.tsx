import { Link } from 'react-router-dom'
import type { Coin } from '../lib/dbc'
import { ago, compact, pct } from '../lib/format'

export function CoinAvatar({ coin, size = 52 }: { coin: Coin; size?: number }) {
  return coin.image ? (
    <img className="avatar" src={coin.image} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <div className="avatar avatar-ph" style={{ width: size, height: size }}>
      {coin.symbol.slice(0, 2)}
    </div>
  )
}

export function Progress({ value, graduated }: { value: number; graduated?: boolean }) {
  return (
    <div className={`bar ${graduated ? 'bar-grad' : ''}`}>
      <div style={{ width: pct(value) }} />
    </div>
  )
}

export default function CoinCard({ coin }: { coin: Coin }) {
  return (
    <Link to={`/coin/${coin.mint}`} className="coin">
      <CoinAvatar coin={coin} />
      <div className="coin-body">
        <div className="coin-top">
          <b className="coin-sym">${coin.symbol}</b>
          <span className="coin-name">{coin.name}</span>
          <span className="coin-age mono">{ago(coin.createdAt)}</span>
        </div>
        <div className="coin-stats mono">
          <span>
            MC <b>{compact(coin.mcapSvx)}</b> SVX
          </span>
          <span>{coin.status === 'graduated' ? 'on Solana' : pct(coin.progress)}</span>
        </div>
        <Progress value={coin.progress} graduated={coin.status === 'graduated'} />
      </div>
    </Link>
  )
}
