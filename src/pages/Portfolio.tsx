import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { buildClaimFees, creatorVault, fetchCoinsByCreator, type Coin } from '../lib/chain'
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
  const [vaults, setVaults] = useState<Record<string, number>>({})
  const prices = useUsdMany((coins ?? []).map((c) => c.quoteMint))

  const load = useCallback(async () => {
    if (!publicKey) return
    const list = await fetchCoinsByCreator(connection, publicKey).catch(() => [] as Coin[])
    setCoins(list)
    const quotes = [...new Set(list.map((c) => c.quoteMint))]
    const vals = await Promise.all(quotes.map((q) => creatorVault(connection, publicKey, q).catch(() => 0)))
    setVaults(Object.fromEntries(quotes.map((q, i) => [q, vals[i]])))
  }, [connection, publicKey])
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

  // one row per pair asset: the creator vault is shared by all coins quoted in it, so one claim pays out all of them
  const groups = Object.values(
    (coins ?? []).reduce<Record<string, { quote: string; coins: Coin[]; total: number }>>((acc, c) => {
      const g = (acc[c.quoteMint] ??= { quote: c.quoteMint, coins: [], total: vaults[c.quoteMint] ?? 0 })
      g.coins.push(c)
      g.total += c.creatorFeeSvx
      return acc
    }, {}),
  ).filter((g) => g.total > 0)

  const claim = async (g: (typeof groups)[number]) => {
    try {
      setBusy(g.quote)
      // sweep the coin holding the most curve fees, then pay out the whole vault for this pair asset
      const c = [...g.coins].sort((a, b) => b.creatorFeeSvx - a.creatorFeeSvx)[0]
      const sig = await submit(await buildClaimFees(connection, c, publicKey), [], () => {}, 'claim')
      toast('ok', `Claimed creator fees in ${symbol(g.quote)}`, sig)
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
          <h1>Portfolio</h1>
          <p>Coins launched by {short(publicKey.toBase58())}.</p>
        </div>
        <Link to="/launch" className="btn btn-primary">
          Launch a coin
        </Link>
      </div>

      <div className="surface pad stack" style={{ marginBottom: 18 }}>
        <h3>Creator fees to claim</h3>
        {coins === null ? (
          <p className="muted">Reading your markets from Solana…</p>
        ) : groups.length ? (
          groups.map((g) => (
            <div className="kv" key={g.quote} style={{ alignItems: 'center' }}>
              <span>
                {compact(g.total)} {symbol(g.quote)} from {g.coins.length} coin{g.coins.length > 1 ? 's' : ''}
              </span>
              <button className="btn btn-ghost btn-sm" disabled={busy === g.quote} onClick={() => claim(g)}>
                {busy === g.quote ? 'Claiming…' : 'Claim'}
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
