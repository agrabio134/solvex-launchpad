import { Link } from 'react-router-dom'
import type { Asset, Coin } from '../lib/chain'
import { useAssets } from '../lib/hooks'
import { ago, compact, pct } from '../lib/format'

export function CoinImg({ coin, size = 44 }: { coin: Pick<Coin, 'image' | 'symbol'>; size?: number }) {
  return coin.image ? (
    <img className="coin-img" src={coin.image} alt="" width={size} height={size} loading="lazy" style={{ borderRadius: size * 0.3 }} />
  ) : (
    <div className="coin-ph" style={{ width: size, height: size, borderRadius: size * 0.3, fontSize: size * 0.32 }}>
      {coin.symbol.slice(0, 2)}
    </div>
  )
}

export function AssetIcon({ asset, mint, size = 22 }: { asset?: Asset; mint?: string; size?: number }) {
  const { find } = useAssets()
  const a = asset ?? (mint ? find(mint) : undefined)
  const logo = a?.logo ?? (a?.symbol === 'SOL' ? 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' : a?.symbol === 'USDC' ? 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' : a?.symbol === 'FLIP' ? '/logo.png' : undefined)
  return logo ? (
    <img className="asset" src={logo} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span className="asset-ph" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {(a?.symbol ?? '?').slice(0, 1)}
    </span>
  )
}

export function PairTag({ mint }: { mint: string }) {
  const { find, symbol } = useAssets()
  const a = find(mint)
  return (
    <span className={`pair ${a?.category === 'stock' ? 'stock' : ''}`}>
      <AssetIcon mint={mint} size={16} />
      {symbol(mint)}
    </span>
  )
}

export function Progress({ value, done }: { value: number; done?: boolean }) {
  return (
    <div className={`bar ${done ? 'done' : ''}`}>
      <i style={{ width: pct(value) }} />
    </div>
  )
}

export function StatusBadge({ coin }: { coin: Coin }) {
  if (coin.migrated) return <span className="badge grad">On Solana</span>
  if (coin.complete) return <span className="badge grad">Ready to migrate</span>
  if (coin.status === 'final') return <span className="badge final">Final stretch</span>
  return <span className="badge">New</span>
}

export function usd(n: number) {
  if (!isFinite(n)) return '—'
  return `$${compact(n, n >= 1000 ? 1 : 2)}`
}

export function MarketRow({ coin, price }: { coin: Coin; price: number | undefined }) {
  const { symbol } = useAssets()
  const q = symbol(coin.quoteMint)
  return (
    <Link to={`/coin/${coin.mint}`} className="mrow">
      <div className="who">
        <CoinImg coin={coin} size={42} />
        <div>
          <div className="name">{coin.name}</div>
          <div className="sym">
            ${coin.symbol} <PairTag mint={coin.quoteMint} />
          </div>
        </div>
      </div>
      <div className="num">
        {price ? usd(coin.mcapSvx * price) : `${compact(coin.mcapSvx)} ${q}`}
        <small>market cap</small>
      </div>
      <div className="num">
        {compact(coin.reserveSvx)} {q}
        <small>in curve</small>
      </div>
      <div className="prog">
        <Progress value={coin.progress} done={coin.complete} />
        <span>{coin.migrated ? 'Graduated to Solana' : coin.complete ? 'Curve complete' : `${pct(coin.progress)} to graduation`}</span>
      </div>
      <div className="age">{ago(coin.createdAt)}</div>
    </Link>
  )
}

export function MarketHead() {
  return (
    <div className="mrow head">
      <div>Coin</div>
      <div>Market cap</div>
      <div>Liquidity</div>
      <div>Bonding curve</div>
      <div style={{ textAlign: 'right' }}>Age</div>
    </div>
  )
}
