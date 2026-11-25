import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { PublicKey } from '@solana/web3.js'
import { buildClaimCreatorFeeTx, buildSwapTx, fetchCoin, fetchTrades, quoteSwap, svxBalance, tokenBalance, type Coin, type Quote, type Trade } from '../lib/dbc'
import { explorerAddr, explorerTx, jupiterSwap } from '../lib/config'
import { ago, compact, pct, price, short } from '../lib/format'
import { errMsg, useLaunchpad, useSend } from '../lib/hooks'
import PriceChart from '../components/PriceChart'
import { useToast } from '../components/Toast'
import { CoinAvatar, Progress } from '../components/CoinCard'

const PRESETS = { buy: ['100', '500', '1000', '5000'], sell: ['25%', '50%', '75%', '100%'] }

export default function Token() {
  const { id = '' } = useParams()
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const { setVisible } = useWalletModal()
  const send = useSend()
  const toast = useToast()

  const [coin, setCoin] = useState<Coin | null>(null)
  const [missing, setMissing] = useState(false)
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(2)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bal, setBal] = useState({ svx: 0, token: 0 })
  const [trades, setTrades] = useState<Trade[]>([])
  const { svxMint } = useLaunchpad()
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const c = await fetchCoin(connection, id)
      setCoin(c)
      setMissing(!c)
      if (c) fetchTrades(connection, c).then(setTrades).catch(() => {})
    } catch {
      setMissing(true)
    }
  }, [connection, id])

  const loadBal = useCallback(async () => {
    if (!publicKey || !coin) return
    const [svx, token] = await Promise.all([svxBalance(connection, publicKey), tokenBalance(connection, publicKey, new PublicKey(coin.mint))])
    setBal({ svx, token })
  }, [connection, publicKey, coin])

  useEffect(() => {
    load()
    const t = setInterval(load, 12000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => {
    loadBal()
  }, [loadBal])

  // live quote
  useEffect(() => {
    setQuote(null)
    const n = Number(amount)
    if (!coin || !n || coin.migrated) return
    setQuoting(true)
    const t = setTimeout(() => {
      quoteSwap(connection, coin.pool, side, n, slippage * 100)
        .then(setQuote)
        .catch(() => setQuote(null))
        .finally(() => setQuoting(false))
    }, 350)
    return () => clearTimeout(t)
  }, [amount, side, slippage, coin?.pool, coin?.migrated, connection])

  if (missing)
    return (
      <div className="wrap page">
        <div className="notice">
          Coin not found. <Link to="/board">Back to the board</Link>
        </div>
      </div>
    )
  if (!coin) return <div className="wrap page"><div className="coin skeleton tall" /></div>

  const isCreator = publicKey?.toBase58() === coin.creator
  const preset = (p: string) => {
    if (side === 'buy') return setAmount(p)
    const f = parseInt(p) / 100
    setAmount(String(+(bal.token * f).toFixed(6)))
  }

  const trade = async () => {
    if (!publicKey) return setVisible(true)
    const n = Number(amount)
    if (!n) return
    if (side === 'buy' && n > bal.svx) return toast('err', 'Not enough SVX')
    if (side === 'sell' && n > bal.token) return toast('err', `Not enough $${coin.symbol}`)
    try {
      setBusy(true)
      const q = quote ?? (await quoteSwap(connection, coin.pool, side, n, slippage * 100))
      const tx = await buildSwapTx(connection, publicKey, coin.pool, side, q)
      const sig = await send(tx)
      toast('ok', `${side === 'buy' ? 'Bought' : 'Sold'} $${coin.symbol}`, sig)
      setAmount('')
      load()
      loadBal()
    } catch (e) {
      toast('err', errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const claim = async () => {
    if (!publicKey) return
    try {
      setBusy(true)
      const sig = await send(await buildClaimCreatorFeeTx(connection, publicKey, coin.pool))
      toast('ok', 'Creator fees claimed', sig)
      load()
    } catch (e) {
      toast('err', errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrap page token">
      <Link to="/board" className="back dim">
        ← Board
      </Link>

      <div className="token-head">
        <CoinAvatar coin={coin} size={84} />
        <div>
          <div className="token-title">
            <h1>${coin.symbol}</h1>
            <span className={`tag tag-${coin.status === 'graduated' ? 'grad' : coin.status}`}>
              {coin.status === 'graduated' ? 'Graduated' : coin.status === 'final' ? 'Final stretch' : 'New'}
            </span>
          </div>
          <div className="dim">{coin.name}</div>
          <button
            className="ca mono small"
            onClick={() => {
              navigator.clipboard.writeText(coin.mint)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            {short(coin.mint, 6)} {copied ? '✓' : '⧉'}
          </button>
        </div>
        <div className="socials">
          {coin.twitter && <a href={coin.twitter} target="_blank" rel="noreferrer">X</a>}
          {coin.telegram && <a href={coin.telegram} target="_blank" rel="noreferrer">TG</a>}
          {coin.website && <a href={coin.website} target="_blank" rel="noreferrer">Web</a>}
        </div>
      </div>

      <div className="token-grid">
        <div className="token-main">
          <div className="kpis">
            <Kpi label="Price" value={`${price(coin.priceSvx)} SVX`} />
            <Kpi label="Market cap" value={`${compact(coin.mcapSvx)} SVX`} />
            <Kpi label="In curve" value={`${compact(coin.reserveSvx)} SVX`} />
            <Kpi label="Age" value={ago(coin.createdAt)} />
          </div>

          <div className="panel">
            <PriceChart trades={trades} current={coin.priceSvx} />
          </div>

          <div className="panel">
            <div className="curve-head">
              <b>Bonding curve</b>
              <span className="mono">{coin.migrated ? 'Complete' : pct(coin.progress)}</span>
            </div>
            <Progress value={coin.progress} graduated={coin.migrated} />
            <p className="dim small">
              {coin.migrated
                ? 'This coin graduated. Its liquidity now sits in a locked Meteora DAMM v2 pool on Solana.'
                : `${compact(Math.max(0, coin.thresholdSvx - coin.reserveSvx))} SVX more and $${coin.symbol} graduates to Solana.`}
            </p>
          </div>

          {coin.description && (
            <div className="panel">
              <b>About</b>
              <p className="dim">{coin.description}</p>
            </div>
          )}

          <div className="panel">
            <div className="curve-head">
              <b>Trades</b>
              <a className="dim small" href={explorerAddr(coin.pool)} target="_blank" rel="noreferrer">
                Pool on explorer ↗
              </a>
            </div>
            {trades.length === 0 ? (
              <p className="dim small">No trades yet. Be the first.</p>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl mono">
                  <thead>
                    <tr>
                      <th>Age</th>
                      <th>Type</th>
                      <th>SVX</th>
                      <th>{coin.symbol}</th>
                      <th>Price</th>
                      <th>Trader</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t) => (
                      <tr key={t.sig}>
                        <td>{ago(t.time)}</td>
                        <td className={t.side === 'buy' ? 'up' : 'down'}>{t.side}</td>
                        <td>{compact(t.svx)}</td>
                        <td>{compact(t.tokens)}</td>
                        <td>{price(t.price)}</td>
                        <td>
                          <a href={explorerAddr(t.trader)} target="_blank" rel="noreferrer">
                            {short(t.trader)}
                          </a>
                        </td>
                        <td className="right">
                          <a href={explorerTx(t.sig)} target="_blank" rel="noreferrer">
                            ↗
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <aside className="token-side">
          {coin.migrated ? (
            <div className="panel">
              <b>Trading moved to Solana</b>
              <p className="dim small">The curve is complete. Trade ${coin.symbol} on any Solana aggregator.</p>
              <a className="btn btn-primary btn-block" href={jupiterSwap(svxMint ?? 'SOL', coin.mint)} target="_blank" rel="noreferrer">
                Trade on Jupiter ↗
              </a>
            </div>
          ) : (
            <div className="panel trade">
              <div className="seg seg-full">
                <button className={side === 'buy' ? 'on buy' : ''} onClick={() => { setSide('buy'); setAmount('') }}>
                  Buy
                </button>
                <button className={side === 'sell' ? 'on sell' : ''} onClick={() => { setSide('sell'); setAmount('') }}>
                  Sell
                </button>
              </div>
              <div className="bal dim small mono">
                Balance: {side === 'buy' ? `${compact(bal.svx)} SVX` : `${compact(bal.token)} ${coin.symbol}`}
              </div>
              <div className="input-suffix">
                <input className="input mono big" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                <i>{side === 'buy' ? 'SVX' : coin.symbol}</i>
              </div>
              <div className="presets">
                {PRESETS[side].map((p) => (
                  <button key={p} onClick={() => preset(p)}>
                    {p}
                  </button>
                ))}
              </div>
              <div className="quote mono small">
                <div>
                  <span className="dim">You receive</span>
                  <span>{quoting ? '…' : quote ? `${compact(quote.amountOut)} ${side === 'buy' ? coin.symbol : 'SVX'}` : '—'}</span>
                </div>
                <div>
                  <span className="dim">Price impact</span>
                  <span className={quote && quote.priceImpact > 0.05 ? 'down' : ''}>{quote ? `${(quote.priceImpact * 100).toFixed(2)}%` : '—'}</span>
                </div>
                <div>
                  <span className="dim">Fee</span>
                  <span>{quote ? `${compact(quote.fee)} SVX` : '—'}</span>
                </div>
                <div>
                  <span className="dim">Slippage</span>
                  <span className="slip">
                    {[1, 2, 5, 10].map((s) => (
                      <button key={s} className={slippage === s ? 'on' : ''} onClick={() => setSlippage(s)}>
                        {s}%
                      </button>
                    ))}
                  </span>
                </div>
              </div>
              <button className={`btn btn-block ${side === 'buy' ? 'btn-primary' : 'btn-sell'}`} disabled={!!publicKey && (busy || !Number(amount))} onClick={trade}>
                {!publicKey ? 'Connect wallet' : busy ? 'Confirming…' : side === 'buy' ? `Buy $${coin.symbol}` : `Sell $${coin.symbol}`}
              </button>
            </div>
          )}

          {isCreator && (
            <div className="panel">
              <b>Creator fees</b>
              <p className="mono big-num">{compact(coin.creatorFeeSvx)} SVX</p>
              <button className="btn btn-ghost btn-block" disabled={busy || coin.creatorFeeSvx <= 0} onClick={claim}>
                Claim
              </button>
            </div>
          )}

          <div className="panel small">
            <div className="kv"><span className="dim">Creator</span><a href={explorerAddr(coin.creator)} target="_blank" rel="noreferrer" className="mono">{short(coin.creator)}</a></div>
            <div className="kv"><span className="dim">Pool</span><a href={explorerAddr(coin.pool)} target="_blank" rel="noreferrer" className="mono">{short(coin.pool)}</a></div>
            <div className="kv"><span className="dim">Graduates at</span><span className="mono">{compact(coin.thresholdSvx)} SVX</span></div>
          </div>
        </aside>
      </div>
    </div>
  )
}

const Kpi = ({ label, value }: { label: string; value: string }) => (
  <div className="kpi">
    <span className="dim small">{label}</span>
    <b className="mono">{value}</b>
  </div>
)
