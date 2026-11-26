import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { PublicKey } from '@solana/web3.js'
import { buildClaimFees, buildClaimLpFees, buildMigrate, fetchCoin, fetchTrades, prepareSwap, quoteBalance, tokenBalance, type Coin, type Prepared, type Trade } from '../lib/dbc'
import { PLATFORM_WALLET, WSOL_MINT, explorerAddr, explorerTx, jupiterSwap } from '../lib/config'
import { ago, compact, pct, price, short } from '../lib/format'
import { errMsg, useAssets, useSubmit, useUsd } from '../lib/hooks'
import { UserError } from '../lib/errors'
import { useToast } from '../components/Toast'
import { CoinImg, PairTag, Progress, StatusBadge, usd as fmtUsd } from '../components/Bits'
import PriceChart from '../components/PriceChart'

export default function Token() {
  const { id = '' } = useParams()
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const { setVisible } = useWalletModal()
  const { find, symbol: symOf } = useAssets()
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
  const [bal, setBal] = useState({ quote: 0, token: 0, sol: 0 })
  const [via, setVia] = useState<'sol' | 'pair'>('sol')
  const [trades, setTrades] = useState<Trade[]>([])
  const [copied, setCopied] = useState(false)
  const [eligible, setEligible] = useState(false)
  const usd = useUsd(coin?.quoteMint)

  const load = useCallback(async () => {
    try {
      const c = await fetchCoin(connection, id)
      setCoin(c)
      setMissing(!c)
      if (c) fetchTrades(connection, c).then(setTrades).catch(() => {})
    } catch {
      /* keep the last good state */
    }
  }, [connection, id])

  const loadBal = useCallback(async () => {
    if (!publicKey || !coin) return
    const [q, t, s] = await Promise.all([
      quoteBalance(connection, publicKey, coin.quoteMint),
      tokenBalance(connection, publicKey, new PublicKey(coin.mint)),
      quoteBalance(connection, publicKey, WSOL_MINT.toBase58()),
    ])
    setBal({ quote: q, token: t, sol: s })
  }, [connection, publicKey, coin?.mint, coin?.quoteMint])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => {
    loadBal()
  }, [loadBal])

  useEffect(() => {
    setQuote(null)
    setQuoteErr('')
    if (!coin || !Number(amount) || (coin.complete && !coin.migrated)) return
    setQuoting(true)
    const t = setTimeout(() => {
      prepareSwap(connection, coin, side, amount, slippage * 100, publicKey ?? PLATFORM_WALLET, via)
        .then(setQuote)
        .catch((e) => setQuoteErr(errMsg(e)))
        .finally(() => setQuoting(false))
    }, 400)
    return () => clearTimeout(t)
  }, [amount, side, slippage, via, coin?.pool, coin?.complete, coin?.migrated, connection, publicKey])

  if (missing)
    return (
      <div className="wrap page">
        <div className="surface empty">
          <h3>This coin isn’t on Flip</h3>
          <p>Check the address, or browse every market instead.</p>
          <Link to="/markets" className="btn btn-primary">
            Browse markets
          </Link>
        </div>
      </div>
    )
  if (!coin)
    return (
      <div className="wrap page">
        <div className="skeleton" style={{ height: 80, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 360 }} />
      </div>
    )

  const q = symOf(coin.quoteMint)
  const isStock = find(coin.quoteMint)?.category === 'stock'
  const isCreator = publicKey?.toBase58() === coin.creator
  const isPlatform = !!publicKey && publicKey.equals(PLATFORM_WALLET)
  const needsMigration = coin.complete && !coin.migrated
  const busy = !!status
  const pairIsSol = coin.quoteMint === WSOL_MINT.toBase58()
  const routed = via === 'sol' && !pairIsSol
  const unit = routed ? 'SOL' : q // what the user pays (buy) or receives (sell)
  const payBal = routed ? bal.sol : bal.quote
  const presets = side === 'sell' ? ['25%', '50%', '75%', '100%'] : unit === 'SOL' ? ['0.1', '0.5', '1', '2'] : ['10', '50', '100', '500']
  const fees = isPlatform ? coin.partnerFeeSvx : coin.creatorFeeSvx

  const run = async (label: string, fn: () => Promise<string | void>, done: string) => {
    if (!publicKey) return setVisible(true)
    try {
      setStatus(label)
      const sig = await fn()
      if (sig) toast('ok', done, sig)
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
    run(
      'Preparing…',
      async () => {
        const n = Number(amount)
        if (!n) return
        if (side === 'buy' && n > payBal)
          throw new UserError(
            unit === 'SOL'
              ? `Not enough SOL. You can spend up to ${compact(payBal)} SOL here; about 0.01 SOL stays in your wallet for network fees.`
              : `You’re paying ${amount} ${q}, but your wallet holds ${compact(payBal)} ${q}.`,
          )
        if (side === 'sell' && n > bal.token) throw new UserError(`You’re selling ${amount} $${coin.symbol}, but your wallet holds ${compact(bal.token)}.`)
        const p = await prepareSwap(connection, coin, side, amount, slippage * 100, publicKey!, via)
        return submit(p.tx, [], setStatus, routed ? 'route' : 'swap', p.luts)
      },
      side === 'buy' ? `Bought $${coin.symbol}` : `Sold $${coin.symbol}`,
    )

  return (
    <div className="wrap page">
      <Link to="/markets" className="back">
        Back to markets
      </Link>

      <div className="coin-head">
        <CoinImg coin={coin} size={76} />
        <div>
          <h1>{coin.name}</h1>
          <div className="meta">
            <b>${coin.symbol}</b>
            <PairTag mint={coin.quoteMint} />
            <StatusBadge coin={coin} />
            <button
              className="copy"
              onClick={() => {
                navigator.clipboard.writeText(coin.mint)
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
            >
              {copied ? 'Copied' : short(coin.mint, 5)}
            </button>
          </div>
        </div>
        <div className="socials">
          {coin.twitter && (
            <a className="btn btn-ghost btn-sm" href={coin.twitter} target="_blank" rel="noreferrer">
              X
            </a>
          )}
          {coin.telegram && (
            <a className="btn btn-ghost btn-sm" href={coin.telegram} target="_blank" rel="noreferrer">
              Telegram
            </a>
          )}
          {coin.website && (
            <a className="btn btn-ghost btn-sm" href={coin.website} target="_blank" rel="noreferrer">
              Website
            </a>
          )}
        </div>
      </div>

      <div className="coin-grid">
        <div className="coin-main">
          <div className="surface stats">
            <div>
              <span>Price</span>
              <b>{usd ? `$${price(coin.priceSvx * usd)}` : `${price(coin.priceSvx)} ${q}`}</b>
            </div>
            <div>
              <span>Market cap</span>
              <b>{usd ? fmtUsd(coin.mcapSvx * usd) : `${compact(coin.mcapSvx)} ${q}`}</b>
            </div>
            <div>
              <span>In the curve</span>
              <b>
                {compact(coin.reserveSvx)} {q}
              </b>
            </div>
            <div>
              <span>Age</span>
              <b>{ago(coin.createdAt)}</b>
            </div>
          </div>

          <div className="surface">
            <PriceChart trades={trades} current={coin.priceSvx} usd={usd} symbol={coin.symbol} quote={q} />
          </div>

          <div className="surface pad stack curve">
            <div className="kv">
              <h3>{coin.migrated ? 'Graduated to Solana' : coin.complete ? 'Curve complete' : 'Bonding curve'}</h3>
              <b>{coin.complete ? '100%' : pct(coin.progress)}</b>
            </div>
            <Progress value={coin.progress} done={coin.complete} />
            <p className="muted">
              {coin.migrated
                ? 'Liquidity now sits in a locked Meteora DAMM v2 pool. Trades on this page route through it.'
                : coin.complete
                  ? 'The curve is full. Anyone can migrate it to Solana, and trading resumes there straight after.'
                  : `${compact(Math.max(0, coin.thresholdSvx - coin.reserveSvx))} ${q} more and $${coin.symbol} graduates to Solana.`}
            </p>
          </div>

          {coin.description && (
            <div className="surface pad stack">
              <h3>About</h3>
              <p className="muted">{coin.description}</p>
            </div>
          )}

          <div className="surface">
            <div className="chart-head" style={{ paddingBottom: 12 }}>
              <b>Recent trades</b>
              <a className="link small" href={explorerAddr(coin.tradingPool)} target="_blank" rel="noreferrer">
                View pool on Solscan
              </a>
            </div>
            {trades.length === 0 ? (
              <p className="muted" style={{ padding: '0 20px 20px' }}>
                No trades to show yet.
              </p>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Side</th>
                      <th>{q}</th>
                      <th>{coin.symbol}</th>
                      <th>Trader</th>
                      <th className="right">Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t) => (
                      <tr key={t.sig}>
                        <td>{ago(t.time)} ago</td>
                        <td className={`side-tag ${t.side === 'buy' ? 'up' : 'down'}`}>{t.side}</td>
                        <td>{compact(t.svx)}</td>
                        <td>{compact(t.tokens)}</td>
                        <td>
                          <a href={explorerAddr(t.trader)} target="_blank" rel="noreferrer">
                            {short(t.trader)}
                          </a>
                        </td>
                        <td className="right">
                          <a className="link" href={explorerTx(t.sig)} target="_blank" rel="noreferrer">
                            View
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

        <aside className="coin-side">
          {needsMigration ? (
            <div className="surface pad stack">
              <h3>Ready to graduate</h3>
              <p className="muted">Migrating moves the curve’s liquidity into a locked Meteora DAMM v2 pool so trading continues on Solana. Anyone can do it and only pays network fees.</p>
              <button className="btn btn-primary btn-block" disabled={!!publicKey && busy} onClick={() => run('Preparing migration…', async () => { const m = await buildMigrate(connection, coin, publicKey!); return submit(m.tx, m.signers, setStatus, 'migrate') }, 'Migrated to Solana')}>
                {!publicKey ? 'Connect wallet' : status || 'Migrate to Solana'}
              </button>
            </div>
          ) : (
            <div className="surface trade stack">
              <div className="seg">
                <button className={side === 'buy' ? 'on buy' : ''} onClick={() => { setSide('buy'); setAmount('') }}>
                  Buy
                </button>
                <button className={side === 'sell' ? 'on sell' : ''} onClick={() => { setSide('sell'); setAmount('') }}>
                  Sell
                </button>
              </div>
              {!pairIsSol && (
                <div className="bal" style={{ alignItems: 'center' }}>
                  <span>{side === 'buy' ? 'Pay with' : 'Receive'}</span>
                  <span className="slip">
                    <button className={via === 'sol' ? 'on' : ''} onClick={() => { setVia('sol'); setAmount('') }}>
                      SOL
                    </button>
                    <button className={via === 'pair' ? 'on' : ''} onClick={() => { setVia('pair'); setAmount('') }}>
                      {q}
                    </button>
                  </span>
                </div>
              )}
              <div className="bal">
                <span>{side === 'buy' ? 'You pay' : 'You sell'}</span>
                <span>
                  Balance {side === 'buy' ? `${compact(payBal)} ${unit}` : `${compact(bal.token)} ${coin.symbol}`}
                </span>
              </div>
              <div className="affix">
                <input className="input big" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Amount" />
                <i className="post">{side === 'buy' ? unit : coin.symbol}</i>
              </div>
              <div className="presets">
                {presets.map((p) => (
                  <button key={p} onClick={() => (side === 'buy' ? setAmount(p) : setAmount(String(Math.floor(bal.token * (parseInt(p) / 100) * 1e6) / 1e6)))}>
                    {p}
                  </button>
                ))}
              </div>
              <div className="quote">
                <div>
                  <span>You receive</span>
                  <b>{quoting ? 'Calculating…' : quote ? `${compact(quote.out)} ${side === 'buy' ? coin.symbol : unit}` : '—'}</b>
                </div>
                <div>
                  <span>Minimum after slippage</span>
                  <span>{quote ? compact(quote.minOut) : '—'}</span>
                </div>
                <div>
                  <span>Price impact and fee</span>
                  <span className={quote?.priceImpact && quote.priceImpact > 5 ? 'down' : ''}>{quote?.priceImpact != null ? `${quote.priceImpact.toFixed(2)}%` : '—'}</span>
                </div>
                <div>
                  <span>Slippage</span>
                  <span className="slip">
                    {[1, 2, 5, 10].map((s) => (
                      <button key={s} className={slippage === s ? 'on' : ''} onClick={() => setSlippage(s)}>
                        {s}%
                      </button>
                    ))}
                  </span>
                </div>
              </div>
              {quoteErr && <div className="err">{quoteErr}</div>}
              {isStock && (
                <label className="check small">
                  <input type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} />
                  <span>I’m eligible to hold {q} under the xStocks issuer terms.</span>
                </label>
              )}
              <button className={`btn btn-block ${side === 'buy' ? 'btn-primary' : 'btn-sell'}`} disabled={!!publicKey && (busy || !Number(amount) || (isStock && !eligible))} onClick={trade}>
                {!publicKey ? 'Connect wallet' : status || (side === 'buy' ? `Buy $${coin.symbol}` : `Sell $${coin.symbol}`)}
              </button>
              <p className="muted small">
                Every trade is simulated before you sign.{' '}
                {routed
                  ? `Your SOL is swapped to ${q} through Jupiter and then into $${coin.symbol}, in one transaction. Any small ${q} left over stays in your wallet.`
                  : `Routed through ${coin.migrated ? 'Meteora DAMM v2' : 'the Meteora bonding curve'}.`}
                {coin.migrated && (
                  <>
                    {' '}
                    <a className="link" href={jupiterSwap(coin.quoteMint, coin.mint)} target="_blank" rel="noreferrer">
                      Also on Jupiter
                    </a>
                  </>
                )}
              </p>
            </div>
          )}

          {(isCreator || isPlatform) && (
            <div className="surface pad stack">
              <h3>{isPlatform ? 'Platform fees' : 'Your creator fees'}</h3>
              <div className="kv">
                <span>Unclaimed from the curve</span>
                <b>
                  {compact(fees)} {q}
                </b>
              </div>
              <button className="btn btn-ghost btn-block" disabled={busy || fees <= 0} onClick={() => run('Preparing claim…', async () => submit(await buildClaimFees(connection, coin, publicKey!), [], setStatus), 'Fees claimed')}>
                Claim curve fees
              </button>
              {coin.migrated && (
                <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => run('Preparing claim…', async () => { let last = ''; for (const tx of await buildClaimLpFees(connection, coin, publicKey!)) last = await submit(tx, [], setStatus); return last }, 'LP fees claimed')}>
                  Claim locked-liquidity fees
                </button>
              )}
            </div>
          )}

          <div className="surface pad stack small">
            <div className="kv">
              <span>Creator</span>
              <a className="link" href={explorerAddr(coin.creator)} target="_blank" rel="noreferrer">{short(coin.creator)}</a>
            </div>
            <div className="kv">
              <span>Pair asset</span>
              <a className="link" href={explorerAddr(coin.quoteMint)} target="_blank" rel="noreferrer">{q}</a>
            </div>
            <div className="kv">
              <span>Curve</span>
              <a className="link" href={explorerAddr(coin.pool)} target="_blank" rel="noreferrer">{short(coin.pool)}</a>
            </div>
            {coin.migrated && (
              <div className="kv">
                <span>DAMM v2 pool</span>
                <a className="link" href={explorerAddr(coin.tradingPool)} target="_blank" rel="noreferrer">{short(coin.tradingPool)}</a>
              </div>
            )}
            <div className="kv">
              <span>Graduates at</span>
              <b>
                {compact(coin.thresholdSvx)} {q} in the curve
              </b>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
