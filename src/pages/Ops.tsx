/**
 * /#ops: platform fee console. Only the platform wallet can enter, after signing a sign-in message
 * (proves the connected wallet really holds the key). Claims still need that wallet's signature on-chain.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { ed25519 } from '@noble/curves/ed25519'
import { buildClaimFees, buildClaimLpFees, fetchCoins, submitMany, type Coin, type SignAll } from '../lib/dbc'
import { LISTED_AFTER, PLATFORM_WALLET, explorerAddr, explorerTx } from '../lib/config'
import { compact, short } from '../lib/format'
import { errMsg, useAssets } from '../lib/hooks'
import { useToast } from '../components/Toast'
import { CoinImg, PairTag } from '../components/Bits'

const SESSION_KEY = 'flip-ops-session'
const SESSION_HOURS = 12

function readSession(wallet: string) {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
    return s && s.wallet === wallet && s.until > Date.now()
  } catch {
    return false
  }
}

type Result = { label: string; ok: boolean; detail: string; sig?: string }

export default function Ops() {
  const { publicKey, signMessage, signAllTransactions, disconnect } = useWallet()
  const { setVisible } = useWalletModal()
  const toast = useToast()
  const wallet = publicKey?.toBase58()
  const isAdmin = !!publicKey && publicKey.equals(PLATFORM_WALLET)
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    setAuthed(!!wallet && isAdmin && readSession(wallet))
  }, [wallet, isAdmin])

  const signIn = async () => {
    if (!publicKey || !signMessage) return toast('err', 'This wallet can’t sign messages. Use Phantom, Solflare or Backpack.')
    try {
      const msg = `Flip ops sign-in\n\nWallet: ${publicKey.toBase58()}\nIssued: ${new Date().toISOString()}\n\nSigning proves you hold this wallet. It costs nothing and sends no transaction.`
      const bytes = new TextEncoder().encode(msg)
      const sig = await signMessage(bytes)
      if (!ed25519.verify(sig, bytes, publicKey.toBytes())) return toast('err', 'That signature doesn’t match the connected wallet.')
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ wallet: publicKey.toBase58(), until: Date.now() + SESSION_HOURS * 3600_000 }))
      setAuthed(true)
    } catch (e) {
      toast('err', errMsg(e))
    }
  }

  if (!publicKey)
    return (
      <Gatekeeper title="Flip ops" body="Connect the platform wallet to manage platform fees.">
        <button className="btn btn-primary" onClick={() => setVisible(true)}>
          Connect wallet
        </button>
      </Gatekeeper>
    )
  if (!isAdmin)
    return (
      <Gatekeeper title="This page is for the Flip platform wallet" body={`The connected wallet ${short(publicKey.toBase58(), 5)} isn’t the platform wallet ${short(PLATFORM_WALLET.toBase58(), 5)}. Switch wallets to continue.`}>
        <button className="btn btn-ghost" onClick={() => disconnect()}>
          Disconnect
        </button>
      </Gatekeeper>
    )
  if (!authed)
    return (
      <Gatekeeper title="Sign in to Flip ops" body="Sign a short message to prove you hold the platform wallet. It’s free and sends no transaction. The session lasts 12 hours in this tab.">
        <button className="btn btn-primary" onClick={signIn}>
          Sign in with wallet
        </button>
      </Gatekeeper>
    )
  return <Console signAll={signAllTransactions as SignAll | undefined} />
}

function Gatekeeper({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="wrap page">
      <div className="surface empty" style={{ maxWidth: 560, margin: '40px auto' }}>
        <h3>{title}</h3>
        <p>{body}</p>
        {children}
      </div>
    </div>
  )
}

function Console({ signAll }: { signAll?: SignAll }) {
  const { connection } = useConnection()
  const { symbol } = useAssets()
  const toast = useToast()
  const [coins, setCoins] = useState<Coin[] | null>(null)
  const [sol, setSol] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [showOld, setShowOld] = useState(true)

  const load = useCallback(async () => {
    try {
      const [list, lamports] = await Promise.all([fetchCoins(connection, { includeUnlisted: true }), connection.getBalance(PLATFORM_WALLET)])
      setCoins(list)
      setSol(lamports / 1e9)
    } catch (e) {
      toast('err', errMsg(e))
      setCoins((c) => c ?? [])
    }
  }, [connection])
  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(() => (coins ?? []).filter((c) => showOld || (c.createdAt ?? 0) >= LISTED_AFTER), [coins, showOld])
  const owed = visible.filter((c) => c.partnerFeeSvx > 0)
  const totals = useMemo(() => {
    const m = new Map<string, number>()
    owed.forEach((c) => m.set(c.quoteMint, (m.get(c.quoteMint) ?? 0) + c.partnerFeeSvx))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [owed])
  const graduated = visible.filter((c) => c.migrated)

  const run = async (items: { label: string; build: () => Promise<any> }[]) => {
    if (!signAll) return toast('err', 'This wallet can’t sign several transactions at once. Use Phantom, Solflare or Backpack.')
    if (!items.length) return toast('info', 'Nothing to claim right now.')
    try {
      setResults([])
      setStatus('Preparing claims…')
      const built: { label: string; tx: any }[] = []
      const failed: Result[] = []
      for (const it of items) {
        try {
          const tx = await it.build()
          ;(Array.isArray(tx) ? tx : [tx]).forEach((t: any, i: number) => built.push({ label: Array.isArray(tx) && tx.length > 1 ? `${it.label} #${i + 1}` : it.label, tx: t }))
        } catch (e) {
          failed.push({ label: it.label, ok: false, detail: errMsg(e) })
        }
      }
      const res = built.length ? await submitMany(connection, PLATFORM_WALLET, signAll, built, setStatus) : []
      const all = [...res, ...failed]
      setResults(all)
      const ok = all.filter((r) => r.ok).length
      toast(ok === all.length ? 'ok' : ok ? 'info' : 'err', `${ok} of ${all.length} claims went through.`)
      await load()
    } catch (e) {
      toast('err', errMsg(e))
    } finally {
      setStatus('')
    }
  }

  const claimCurve = (list: Coin[]) => run(list.map((c) => ({ label: `$${c.symbol} curve fees`, build: () => buildClaimFees(connection, c, PLATFORM_WALLET) })))
  const claimLp = (list: Coin[]) => run(list.map((c) => ({ label: `$${c.symbol} locked-LP fees`, build: () => buildClaimLpFees(connection, c, PLATFORM_WALLET) })))
  const busy = !!status

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>Flip ops</h1>
          <p>Platform fees across every market on {short(PLATFORM_WALLET.toBase58(), 5)}.</p>
        </div>
        <button className="btn btn-ghost" onClick={load} disabled={busy}>
          Refresh
        </button>
      </div>

      {sol !== null && sol < 0.02 && (
        <div className="note" style={{ marginBottom: 18 }}>
          The platform wallet has {sol.toFixed(4)} SOL. Each claim costs a small network fee, and receiving a token for the first time costs about 0.002 SOL in account rent.
          Add at least 0.02 SOL before claiming.
        </div>
      )}

      <div className="surface stats" style={{ marginBottom: 18 }}>
        <div>
          <span>Platform wallet SOL</span>
          <b>{sol === null ? '…' : sol.toFixed(4)}</b>
        </div>
        <div>
          <span>Markets</span>
          <b>{coins ? visible.length : '…'}</b>
        </div>
        <div>
          <span>With fees to claim</span>
          <b>{coins ? owed.length : '…'}</b>
        </div>
        <div>
          <span>Graduated</span>
          <b>{coins ? graduated.length : '…'}</b>
        </div>
      </div>

      <div className="surface pad stack" style={{ marginBottom: 18 }}>
        <div className="kv" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <h3>Unclaimed curve fees</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !owed.length} onClick={() => claimCurve(owed)}>
              {status || `Claim all (${owed.length})`}
            </button>
            {graduated.length > 0 && (
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => claimLp(graduated)}>
                Claim locked-LP fees ({graduated.length})
              </button>
            )}
          </div>
        </div>
        {totals.length ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {totals.map(([mint, amt]) => (
              <span key={mint} className="pill">
                <PairTag mint={mint} /> {compact(amt)} {symbol(mint)}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">{coins ? 'No curve fees waiting. They build up as people trade.' : 'Reading markets from Solana…'}</p>
        )}
        <label className="check small">
          <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />
          <span>Include markets from the old FirePad launchpad (hidden from the public site)</span>
        </label>
      </div>

      {results.length > 0 && (
        <div className="surface" style={{ marginBottom: 18 }}>
          <div className="chart-head" style={{ paddingBottom: 12 }}>
            <b>Last run</b>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td>{r.label}</td>
                    <td className={r.ok ? 'up' : 'down'}>{r.detail}</td>
                    <td className="right">
                      {r.sig && (
                        <a className="link" href={explorerTx(r.sig)} target="_blank" rel="noreferrer">
                          View
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="surface">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Market</th>
                <th>Pair</th>
                <th>Status</th>
                <th>Unclaimed (platform)</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {coins === null ? (
                <tr>
                  <td colSpan={5} className="muted">
                    Reading markets from Solana…
                  </td>
                </tr>
              ) : visible.length ? (
                visible.map((c) => (
                  <tr key={c.pool}>
                    <td>
                      <Link to={`/coin/${c.mint}`} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <CoinImg coin={c} size={30} />
                        <span>
                          <b>${c.symbol}</b>
                          {(c.createdAt ?? 0) < LISTED_AFTER && <span className="muted small"> (FirePad)</span>}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <PairTag mint={c.quoteMint} />
                    </td>
                    <td>{c.migrated ? 'On Solana' : c.complete ? 'Ready to migrate' : `${Math.round(c.progress * 100)}% of curve`}</td>
                    <td>
                      {compact(c.partnerFeeSvx)} {symbol(c.quoteMint)}
                    </td>
                    <td className="right" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" disabled={busy || c.partnerFeeSvx <= 0} onClick={() => claimCurve([c])}>
                        Claim
                      </button>{' '}
                      {c.migrated && (
                        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => claimLp([c])}>
                          LP fees
                        </button>
                      )}{' '}
                      <a className="link small" href={explorerAddr(c.pool)} target="_blank" rel="noreferrer">
                        Solscan
                      </a>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="muted">
                    No markets yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
