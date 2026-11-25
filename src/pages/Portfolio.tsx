import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { buildClaimFees, fetchCoins, fetchCoinsByCreator, type Coin } from '../lib/dbc'
import { PLATFORM_WALLET } from '../lib/config'
import { compact, short } from '../lib/format'
import { errMsg, useAssets, useSubmit, useUsdMany } from '../lib/hooks'
import { useToast } from '../components/Toast'
import { MarketHead, MarketRow } from '../components/Bits'

export default function Portfolio() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const { setVisible } = useWalletModal()
  const { symbol } = useAssets()
  const submit = useSubmit()
  const toast = useToast()
  const [coins, setCoins] = useState<Coin[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const isPlatform = !!publicKey && publicKey.equals(PLATFORM_WALLET)
  const prices = useUsdMany((coins ?? []).map((c) => c.quoteMint))

  const load = useCallback(async () => {
    if (!publicKey) return
    setCoins(await (isPlatform ? fetchCoins(connection) : fetchCoinsByCreator(connection, publicKey)).catch(() => []))
  }, [connection, publicKey, isPlatform])
  useEffect(() => {
    load()
  }, [load])

  if (!publicKey)
    return (
      <div className="wrap page">
        <div className="surface empty">
          <h3>Connect your wallet</h3>
          <p>See the coins you launched and claim the trading fees they’ve earned.</p>
          <button className="btn btn-primary" onClick={() => setVisible(true)}>
            Connect wallet
          </button>
        </div>
      </div>
    )

  const feeOf = (c: Coin) => (isPlatform ? c.partnerFeeSvx : c.creatorFeeSvx)
  const claimable = (coins ?? []).filter((c) => feeOf(c) > 0)

  const claim = async (c: Coin) => {
    try {
      setBusy(c.pool)
      const sig = await submit(await buildClaimFees(connection, c, publicKey), [], () => {})
      toast('ok', `Claimed fees from $${c.symbol}`, sig)
      load()
    } catch (e) {
      toast('err', errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>{isPlatform ? 'Platform' : 'Portfolio'}</h1>
          <p>{isPlatform ? 'Every Solvex market and the platform’s share of its fees.' : `Coins launched by ${short(publicKey.toBase58())}.`}</p>
        </div>
        <Link to="/launch" className="btn btn-primary">
          Launch a coin
        </Link>
      </div>

      <div className="surface pad stack" style={{ marginBottom: 18 }}>
        <h3>Fees to claim</h3>
        {coins === null ? (
          <p className="muted">Reading your markets from Solana…</p>
        ) : claimable.length ? (
          claimable.map((c) => (
            <div className="kv" key={c.pool} style={{ alignItems: 'center' }}>
              <span>
                ${c.symbol}: {compact(feeOf(c))} {symbol(c.quoteMint)}
              </span>
              <button className="btn btn-ghost btn-sm" disabled={busy === c.pool} onClick={() => claim(c)}>
                {busy === c.pool ? 'Claiming…' : 'Claim'}
              </button>
            </div>
          ))
        ) : (
          <p className="muted">Nothing to claim yet. Fees build up as people trade your coins.</p>
        )}
      </div>

      <div className="surface market-table">
        <MarketHead />
        {coins === null ? (
          <div className="skeleton" style={{ height: 58, margin: '10px 20px' }} />
        ) : coins.length ? (
          coins.map((c) => <MarketRow key={c.pool} coin={c} price={prices[c.quoteMint]} />)
        ) : (
          <div className="empty">
            <h3>No coins launched from this wallet</h3>
            <p>Launch one and it shows up here.</p>
            <Link to="/launch" className="btn btn-primary">
              Launch a coin
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
