import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { buildClaimFees, fetchCoins, fetchCoinsByCreator, svxBalance, type Coin } from '../lib/dbc'
import { PLATFORM_WALLET } from '../lib/config'
import { compact, pct } from '../lib/format'
import { errMsg, useSubmit } from '../lib/hooks'
import { useToast } from '../components/Toast'
import { CoinAvatar, Progress } from '../components/CoinCard'

/** Creator view (coins you launched). The platform wallet sees every market and its platform fees. */
export default function Profile() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const { setVisible } = useWalletModal()
  const submit = useSubmit()
  const toast = useToast()
  const [coins, setCoins] = useState<Coin[] | null>(null)
  const [flip, setFlip] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const isPlatform = !!publicKey && publicKey.equals(PLATFORM_WALLET)

  const load = useCallback(async () => {
    if (!publicKey) return
    setCoins(await (isPlatform ? fetchCoins(connection) : fetchCoinsByCreator(connection, publicKey)).catch(() => []))
    setFlip(await svxBalance(connection, publicKey).catch(() => 0))
  }, [connection, publicKey, isPlatform])

  useEffect(() => {
    load()
  }, [load])

  if (!publicKey)
    return (
      <div className="wrap page">
        <div className="panel center-panel">
          <h2>My coins</h2>
          <p className="dim">Connect a wallet to see the coins you launched and claim your creator fees.</p>
          <button className="btn btn-primary" onClick={() => setVisible(true)}>
            Connect wallet
          </button>
        </div>
      </div>
    )

  const feeOf = (c: Coin) => (isPlatform ? c.partnerFeeSvx : c.creatorFeeSvx)
  const total = (coins ?? []).reduce((s, c) => s + feeOf(c), 0)

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
          <h1>{isPlatform ? 'Platform' : 'My coins'}</h1>
          <p className="dim">{isPlatform ? 'Every Solvex market and the platform share of its fees.' : 'Coins launched from this wallet on Solvex.'}</p>
        </div>
        <Link to="/launch" className="btn btn-primary">
          + Launch a coin
        </Link>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="dim small">FLIP balance</span><b className="mono">{compact(flip)}</b></div>
        <div className="kpi"><span className="dim small">{isPlatform ? 'Markets' : 'Coins launched'}</span><b className="mono">{coins?.length ?? '—'}</b></div>
        <div className="kpi"><span className="dim small">Unclaimed fees</span><b className="mono">{compact(total)} FLIP</b></div>
      </div>

      <div className="panel">
        {coins === null ? (
          <p className="dim">Loading…</p>
        ) : coins.length === 0 ? (
          <p className="dim">
            No coins yet. <Link to="/launch">Launch your first →</Link>
          </p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl tbl-coins">
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Market cap</th>
                  <th>Curve</th>
                  <th>Fees</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {coins.map((c) => (
                  <tr key={c.pool}>
                    <td>
                      <Link to={`/coin/${c.mint}`} className="tbl-coin">
                        <CoinAvatar coin={c} size={34} />
                        <b>${c.symbol}</b>
                      </Link>
                    </td>
                    <td className="mono">{compact(c.mcapSvx)} FLIP</td>
                    <td style={{ minWidth: 120 }}>
                      <Progress value={c.progress} graduated={c.complete} />
                      <span className="mono small dim">{c.migrated ? 'on Solana' : c.complete ? 'ready to migrate' : pct(c.progress)}</span>
                    </td>
                    <td className="mono">{compact(feeOf(c))} FLIP</td>
                    <td className="right">
                      <button className="btn btn-ghost btn-sm" disabled={busy === c.pool || feeOf(c) <= 0} onClick={() => claim(c)}>
                        {busy === c.pool ? '…' : 'Claim'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
