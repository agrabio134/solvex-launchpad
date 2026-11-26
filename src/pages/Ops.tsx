/**
 * /#ops: admin console. Only the admin wallet can enter, after signing a sign-in message
 * (proves the connected wallet really holds the key). Hiding or restoring a market needs a fresh
 * signed message that the server checks against the admin wallet.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { ed25519 } from '@noble/curves/ed25519'
import bs58 from 'bs58'
import { fetchCoins, type Coin } from '../lib/chain'
import { PLATFORM_WALLET, explorerAddr } from '../lib/config'
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

export default function Ops() {
  const { publicKey, signMessage, disconnect } = useWallet()
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
      <Gatekeeper title="Flip ops" body="Connect the admin wallet to manage the markets listed on Flip.">
        <button className="btn btn-primary" onClick={() => setVisible(true)}>
          Connect wallet
        </button>
      </Gatekeeper>
    )
  if (!isAdmin)
    return (
      <Gatekeeper title="This page is for the Flip admin wallet" body={`The connected wallet ${short(publicKey.toBase58(), 5)} isn’t the admin wallet ${short(PLATFORM_WALLET.toBase58(), 5)}. Switch wallets to continue.`}>
        <button className="btn btn-ghost" onClick={() => disconnect()}>
          Disconnect
        </button>
      </Gatekeeper>
    )
  if (!authed)
    return (
      <Gatekeeper title="Sign in to Flip ops" body="Sign a short message to prove you hold the admin wallet. It’s free and sends no transaction. The session lasts 12 hours in this tab.">
        <button className="btn btn-primary" onClick={signIn}>
          Sign in with wallet
        </button>
      </Gatekeeper>
    )
  return <Console sign={signMessage} />
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

function Console({ sign }: { sign?: (m: Uint8Array) => Promise<Uint8Array> }) {
  const { connection } = useConnection()
  const { symbol } = useAssets()
  const toast = useToast()
  const [coins, setCoins] = useState<Coin[] | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setCoins(await fetchCoins(connection, { includeUnlisted: true }))
    } catch (e) {
      toast('err', errMsg(e))
      setCoins((c) => c ?? [])
    }
  }, [connection])
  useEffect(() => {
    load()
  }, [load])

  const toggle = async (c: Coin) => {
    if (!sign) return toast('err', 'This wallet can’t sign messages. Use Phantom, Solflare or Backpack.')
    const op = c.hidden ? 'show' : 'hide'
    try {
      setBusy(c.mint)
      const message = `Flip ops: ${op} ${c.mint}\nIssued: ${Date.now()}`
      const signature = bs58.encode(await sign(new TextEncoder().encode(message)))
      const r = await fetch('/api/coins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, mint: c.mint, message, signature }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Request failed')
      toast('ok', op === 'hide' ? `$${c.symbol} is hidden from Flip` : `$${c.symbol} is listed again`)
      await new Promise((res) => setTimeout(res, 1200))
      await load()
    } catch (e) {
      toast('err', errMsg(e))
    } finally {
      setBusy('')
    }
  }

  const list = coins ?? []
  const hidden = list.filter((c) => c.hidden).length
  const graduated = list.filter((c) => c.complete).length

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>Flip ops</h1>
          <p>Every coin launched on Flip. Hide one to take it off the public site; it keeps trading on pump.fun.</p>
        </div>
        <button className="btn btn-ghost" onClick={load} disabled={!!busy}>
          Refresh
        </button>
      </div>

      <div className="surface stats" style={{ marginBottom: 18 }}>
        <div>
          <span>Launched on Flip</span>
          <b>{coins ? list.length : '…'}</b>
        </div>
        <div>
          <span>Listed</span>
          <b>{coins ? list.length - hidden : '…'}</b>
        </div>
        <div>
          <span>Hidden</span>
          <b>{coins ? hidden : '…'}</b>
        </div>
        <div>
          <span>Graduated</span>
          <b>{coins ? graduated : '…'}</b>
        </div>
      </div>

      <div className="surface">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Market</th>
                <th>Pair</th>
                <th>Status</th>
                <th>Creator</th>
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
              ) : list.length ? (
                list.map((c) => (
                  <tr key={c.mint} style={c.hidden ? { opacity: 0.6 } : undefined}>
                    <td>
                      <Link to={`/coin/${c.mint}`} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <CoinImg coin={c} size={30} />
                        <span>
                          <b>${c.symbol}</b>
                          {c.hidden && <span className="muted small"> (hidden)</span>}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <PairTag mint={c.quoteMint} />
                    </td>
                    <td>
                      {c.migrated ? 'On PumpSwap' : c.complete ? 'Graduating' : `${Math.round(c.progress * 100)}% of curve`} · {compact(c.reserveSvx)} {symbol(c.quoteMint)}
                    </td>
                    <td>
                      <a className="link" href={explorerAddr(c.creator)} target="_blank" rel="noreferrer">
                        {short(c.creator)}
                      </a>
                    </td>
                    <td className="right" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => toggle(c)}>
                        {busy === c.mint ? 'Signing…' : c.hidden ? 'Show' : 'Hide'}
                      </button>{' '}
                      <a className="link small" href={`https://pump.fun/coin/${c.mint}`} target="_blank" rel="noreferrer">
                        pump.fun
                      </a>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="muted">
                    No coins launched on Flip yet.
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
