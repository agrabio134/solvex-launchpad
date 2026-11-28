import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FLIP_CA, WSOL_MINT, X_URL, jupiterSwap } from '../lib/config'
import { quoteUsd } from '../lib/chain'
import { compact, price as fmtPrice } from '../lib/format'
import { useToast } from '../components/Toast'

const SUPPLY = 1_000_000_000

/** $FLIP: the official contract address, live price and where to buy. */
export default function Flip() {
  const toast = useToast()
  const [usd, setUsd] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    const tick = () => quoteUsd(FLIP_CA).then((v) => alive && v && setUsd(v))
    tick()
    const t = setInterval(tick, 30000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

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
            <b>{usd ? `$${fmtPrice(usd)}` : '…'}</b>
          </div>
          <div>
            <span>Market cap</span>
            <b>{usd ? `$${compact(usd * SUPPLY)}` : '…'}</b>
          </div>
          <div>
            <span>Supply</span>
            <b>1B, fixed</b>
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
