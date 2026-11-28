import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FLIP_CA, WSOL_MINT, X_URL, jupiterSwap } from '../lib/config'
import { useConnection } from '@solana/wallet-adapter-react'
import { fetchCoin, quoteUsd } from '../lib/chain'
import { compact, price as fmtPrice } from '../lib/format'
import { useToast } from '../components/Toast'


/** $FLIP: the official contract address, live price and where to buy. */
export default function Flip() {
  const toast = useToast()
  const { connection } = useConnection()
  const [stats, setStats] = useState<{ usd: number; mcap: number; supply: number } | null>(null)
  const [copied, setCopied] = useState(false)

  // price straight from the coin's own curve or PumpSwap pool, the same numbers as its coin page
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const c = await fetchCoin(connection, FLIP_CA)
        if (!c || !c.priceSvx) return
        const q = await quoteUsd(c.quoteMint)
        if (alive && q) setStats({ usd: c.priceSvx * q, mcap: c.mcapSvx * q, supply: c.mcapSvx / c.priceSvx })
      } catch {
        /* keep the last numbers */
      }
    }
    tick()
    const t = setInterval(tick, 15000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [connection])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(FLIP_CA)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast('err', 'Couldn’t copy. Select the address and copy it manually.')
    }
  }

  return (
    <div className="wrap page">
      <div className="flip-page">
        <div className="flip-coin" aria-hidden>
          <img src="/icon-192.png" alt="" />
        </div>
        <h1>
          $FLIP <span className="soon-big live">Live</span>
        </h1>
        <p className="lead">The official Flip token, live on Solana. This is the only contract address for $FLIP.</p>

        <div className="ca-box">
          <div className="ca-text">
            <span>Official contract address</span>
            <b>{FLIP_CA}</b>
          </div>
          <button className="btn btn-primary btn-sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="flip-stats">
          <div>
            <span>Price</span>
            <b>{stats ? `$${fmtPrice(stats.usd)}` : '…'}</b>
          </div>
          <div>
            <span>Market cap</span>
            <b>{stats ? `$${compact(stats.mcap)}` : '…'}</b>
          </div>
          <div>
            <span>Supply</span>
            <b>{stats ? compact(stats.supply) : '…'}</b>
          </div>
        </div>

        <div className="flip-actions">
          <a className="btn btn-primary" href={`https://pump.fun/coin/${FLIP_CA}`} target="_blank" rel="noreferrer">
            Buy on pump.fun
          </a>
          <a className="btn btn-ghost" href={jupiterSwap(WSOL_MINT.toBase58(), FLIP_CA)} target="_blank" rel="noreferrer">
            Buy on Jupiter
          </a>
          <a className="btn btn-ghost" href={`https://dexscreener.com/solana/${FLIP_CA}`} target="_blank" rel="noreferrer">
            Chart
          </a>
          <a className="btn btn-ghost" href={`https://solscan.io/token/${FLIP_CA}`} target="_blank" rel="noreferrer">
            Solscan
          </a>
        </div>

        <p className="flip-note">
          Always check the address matches this page before you buy. Follow <a className="link" href={X_URL} target="_blank" rel="noreferrer">Flip on X</a> for updates, or{' '}
          <Link className="link" to="/launch">
            launch your own coin
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
