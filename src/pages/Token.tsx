import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { PublicKey } from '@solana/web3.js'
import {
  buildClaimFees,
  buildClaimLpFees,
  buildMigrate,
  fetchCoin,
  fetchTrades,
  prepareSwap,
  svxBalance,
  tokenBalance,
  type Coin,
  type Prepared,
  type Trade,
} from '../lib/dbc'
import { PLATFORM_WALLET, Q, QUOTE_MINT, explorerAddr, explorerTx, jupiterSwap } from '../lib/config'
import { ago, compact, pct, price, short } from '../lib/format'
import { errMsg, useLaunchpad, useSubmit } from '../lib/hooks'
import { useToast } from '../components/Toast'
import { CoinAvatar, Progress } from '../components/CoinCard'
import PriceChart from '../components/PriceChart'

const PRESETS = { buy: Q === 'SOL' ? ['0.1', '0.5', '1', '2'] : ['100', '500', '1000', '5000'], sell: ['25%', '50%', '75%', '100%'] }

export default function Token() {
  const { id = '' } = useParams()
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const { setVisible } = useWalletModal()
  const { usd } = useLaunchpad()
  const submit = useSubmit()
  const toast = useToast()

  const [coin, setCoin] = useState<Coin | null>(null)
  const [missing, setMissing] = useState(false)
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(2)
  const [quote, setQuote] = useState<Prepared | null>(null)
  const [quoteErr, setQuoteErr] = useState('')
  const [quoting, setQuoting] = useState(false)
  const [status, setStatus] = useState('')
  const [bal, setBal] = useState({ svx: 0, token: 0 })
  const [trades, setTrades] = useState<Trade[]>([])
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const c = await fetchCoin(connection, id)
      setCoin(c)
      setMissing(!c)
      if (c) fetchTrades(connection, c).then(setTrades).catch(() => {})
    } catch {
      setMissing((m) => m || false)
    }
  }, [connection, id])

  const loadBal = useCallback(async () => {
    if (!publicKey || !coin) return
    const [svx, token] = await Promise.all([svxBalance(connection, publicKey), tokenBalance(connection, publicKey, new PublicKey(coin.mint))])
    setBal({ svx, token })
  }, [connection, publicKey, coin?.mint])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => {
    loadBal()
  }, [loadBal])

  // live quote (builds the real transaction, refreshed while typing)
  useEffect(() => {
    setQuote(null)
    setQuoteErr('')
    if (!coin || !Number(amount) || (coin.complete && !coin.migrated)) return
    const owner = publicKey ?? PLATFORM_WALLET
    setQuoting(true)
    const t = setTimeout(() => {
      prepareSwap(connection, coin, side, amount, slippage * 100, owner)
        .then(setQuote)
        .catch((e) => setQuoteErr(errMsg(e)))
        .finally(() => setQuoting(false))
    }, 400)
    return () => clearTimeout(t)
  }, [amount, side, slippage, coin?.pool, coin?.complete, coin?.migrated, connection, publicKey])

  if (missing)
    return (
      <div className="wrap page">
        <div className="notice">
          This coin isn't a Solvex market. <Link to="/board">Back to the board</Link>
        </div>
      </div>
    )
  if (!coin)
    return (
      <div className="wrap page">
        <div className="coin skeleton tall" />
      </div>
    )

  const me = publicKey?.toBase58()
  const isCreator = me === coin.creator
  const isPlatform = !!publicKey && publicKey.equals(PLATFORM_WALLET)
  const needsMigration = coin.complete && !coin.migrated
  const busy = !!status

  const run = async (label: string, fn: () => Promise<string | void>) => {
    if (!publicKey) return setVisible(true)
    try {
      setStatus(label)
      const sig = await fn()
      if (sig) toast('ok', 'Done', sig)
      setAmount('')
      await load()
      await loadBal()
    } catch (e) {
      toast('err', errMsg(e))
    } finally {
      setStatus('')
    }
  }

  const trade = () =>
    run('Preparing…', async () => {
      const n = Number(amount)
      if (!n) return
      if (side === 'buy' && n > bal.svx) throw new Error(`Not enough ${Q}`)
      if (side === 'sell' && n > bal.token) throw new Error(`Not enough $${coin.symbol}`)
      const p = await prepareSwap(connection, coin, side, amount, slippage * 100, publicKey!)
      return submit(p.tx, [], setStatus)
    })

  const migrate = () =>
    run('Preparing migration…', async () => {
      const m = await buildMigrate(connection, coin, publicKey!)
      return submit(m.tx, m.signers, setStatus)
    })

  const claim = () =>
    run('Preparing claim…', async () => submit(await buildClaimFees(connection, coin, publicKey!), [], setStatus))

  const claimLp = () =>
    run('Preparing claim…', async () => {
      const txs = await buildClaimLpFees(connection, coin, publicKey!)
      let last = ''
      for (const tx of txs) last = await submit(tx, [], setStatus)
      return last
    })

  const preset = (p: string) => {
    if (side === 'buy') return setAmount(p)
    const f = parseInt(p) / 100
    setAmount(String(Math.floor(bal.token * f * 1e6) / 1e6))
  }

  const statusLabel = coin.migrated ? 'On Solana' : coin.complete ? 'Curve complete' : coin.status === 'final' ? 'Final stretch' : 'New'

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
            <span className={`tag tag-${coin.status === 'graduated' ? 'grad' : coin.status}`}>{statusLabel}</span>
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
            <Kpi label="Price" value={usd ? `$${price(coin.priceSvx * usd)}` : `${price(coin.priceSvx)} ${Q}`} />
            <Kpi label="Market cap" value={usd ? `$${compact(coin.mcapSvx * usd)}` : `${compact(coin.mcapSvx)} ${Q}`} />
            <Kpi label="In curve" value={`${compact(coin.reserveSvx)} ${Q}`} />
            <Kpi label="Age" value={ago(coin.createdAt)} />
          </div>

          <div className="panel">
            <PriceChart trades={trades} current={coin.priceSvx} usd={usd} symbol={coin.symbol} />
          </div>

          <div className="panel">
            <div className="curve-head">
              <b>Bonding curve</b>
              <span className="mono">{coin.complete ? 'Complete' : pct(coin.progress)}</span>
            </div>
            <Progress value={coin.progress} graduated={coin.complete} />
            <p className="dim small">
              {coin.migrated
                ? 'Graduated. Liquidity sits in a locked Meteora DAMM v2 pool on Solana, and trades here route through it.'
                : coin.complete
                  ? 'The curve is full. Anyone can migrate it to Solana; trading resumes there right after.'
                  : `${compact(Math.max(0, coin.thresholdSvx - coin.reserveSvx))} ${Q} more and $${coin.symbol} graduates to Solana.`}
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
              <a className="dim small" href={explorerAddr(coin.tradingPool)} target="_blank" rel="noreferrer">
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
                      <th>{Q}</th>
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
          {needsMigration ? (
            <div className="panel">
              <b>Ready to graduate</b>
              <p className="dim small">The curve is full. Migrating moves its liquidity into a locked Meteora DAMM v2 pool so trading continues on Solana. Anyone can do it; you pay only network fees.</p>
              <button className="btn btn-primary btn-block" disabled={!!publicKey && busy} onClick={migrate}>
                {!publicKey ? 'Connect wallet' : status || 'Migrate to Solana'}
              </button>
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
              <div className="bal dim small mono">Balance: {side === 'buy' ? `${compact(bal.svx)} ${Q}` : `${compact(bal.token)} ${coin.symbol}`}</div>
              <div className="input-suffix">
                <input className="input mono big" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                <i>{side === 'buy' ? Q : coin.symbol}</i>
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
                  <span>{quoting ? '…' : quote ? `${compact(quote.out)} ${side === 'buy' ? coin.symbol : Q}` : '—'}</span>
                </div>
                <div>
                  <span className="dim">Minimum</span>
                  <span>{quote ? compact(quote.minOut) : '—'}</span>
                </div>
                <div>
                  <span className="dim">Price impact + fee</span>
                  <span className={quote?.priceImpact && quote.priceImpact > 5 ? 'down' : ''}>{quote?.priceImpact != null ? `${quote.priceImpact.toFixed(2)}%` : '—'}</span>
                </div>
                <div>
                  <span className="dim">Route</span>
                  <span>{coin.migrated ? 'Meteora DAMM v2' : 'Bonding curve'}</span>
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
              {quoteErr && <p className="down small">{quoteErr}</p>}
              <button className={`btn btn-block ${side === 'buy' ? 'btn-primary' : 'btn-sell'}`} disabled={!!publicKey && (busy || !Number(amount))} onClick={trade}>
                {!publicKey ? 'Connect wallet' : status || (side === 'buy' ? `Buy $${coin.symbol}` : `Sell $${coin.symbol}`)}
              </button>
              {coin.migrated && (
                <a className="dim small center-link" href={jupiterSwap(QUOTE_MINT.toBase58(), coin.mint)} target="_blank" rel="noreferrer">
                  Also tradable on Jupiter ↗
                </a>
              )}
            </div>
          )}

          {(isCreator || isPlatform) && (
            <div className="panel">
              <b>{isPlatform ? 'Platform fees' : 'Creator fees'}</b>
              <p className="mono big-num">{compact(isPlatform ? coin.partnerFeeSvx : coin.creatorFeeSvx)}&nbsp;{Q}</p>
              <button className="btn btn-ghost btn-block" disabled={busy || (isPlatform ? coin.partnerFeeSvx : coin.creatorFeeSvx) <= 0} onClick={claim}>
                Claim curve fees
              </button>
              {coin.migrated && (
                <button className="btn btn-ghost btn-block" disabled={busy} onClick={claimLp}>
                  Claim locked-LP fees
                </button>
              )}
            </div>
          )}

          <div className="panel small">
            <div className="kv"><span className="dim">Creator</span><a href={explorerAddr(coin.creator)} target="_blank" rel="noreferrer" className="mono">{short(coin.creator)}</a></div>
            <div className="kv"><span className="dim">Curve</span><a href={explorerAddr(coin.pool)} target="_blank" rel="noreferrer" className="mono">{short(coin.pool)}</a></div>
            {coin.migrated && <div className="kv"><span className="dim">DAMM v2 pool</span><a href={explorerAddr(coin.tradingPool)} target="_blank" rel="noreferrer" className="mono">{short(coin.tradingPool)}</a></div>}
            <div className="kv"><span className="dim">Graduates at</span><span className="mono">{compact(coin.thresholdSvx)}&nbsp;{Q}</span></div>
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
