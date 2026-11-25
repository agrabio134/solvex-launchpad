import { useEffect, useMemo, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { PublicKey } from '@solana/web3.js'
import { validateConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { buildCreateConfigTx, buildCurve, buildPartnerClaimTxs, mintDecimals, partnerFeesOwed } from '../lib/dbc'
import { CONFIGURED, DBC_CONFIG, SVX_MINT_ENV, explorerAddr } from '../lib/config'
import { errMsg, useLaunchpad, useSend } from '../lib/hooks'
import { compact, short } from '../lib/format'
import { useToast } from '../components/Toast'

/**
 * One-time launchpad setup + partner tools.
 * Creating the config makes the connected wallet the Solvex fee claimer.
 */
export default function Admin() {
  const { publicKey } = useWallet()
  const { setVisible } = useWalletModal()

  return (
    <div className="wrap page admin">
      <div className="page-head">
        <div>
          <h1>Launchpad admin</h1>
          <p className="dim">
            {CONFIGURED ? 'The Solvex curve is live. Claim the platform share of trading fees here.' : 'Create the Solvex bonding-curve config. Do this once.'}
          </p>
        </div>
      </div>
      {!publicKey ? (
        <div className="panel center-panel">
          <p className="dim">Connect the wallet that should own the launchpad and receive platform fees.</p>
          <button className="btn btn-primary" onClick={() => setVisible(true)}>
            Connect wallet
          </button>
        </div>
      ) : CONFIGURED ? (
        <Live admin={publicKey} />
      ) : (
        <Setup admin={publicKey} />
      )}
    </div>
  )
}

function Setup({ admin }: { admin: PublicKey }) {
  const { connection } = useConnection()
  const send = useSend()
  const toast = useToast()
  const [mint, setMint] = useState(SVX_MINT_ENV?.toBase58() ?? '')
  const [decimals, setDecimals] = useState<number | null>(null)
  const [mintErr, setMintErr] = useState('')
  const [initialMcap, setInitialMcap] = useState('30000')
  const [migrationMcap, setMigrationMcap] = useState('400000')
  const [feePct, setFeePct] = useState('1')
  const [creatorPct, setCreatorPct] = useState('50')
  const [launchFee, setLaunchFee] = useState('0')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)

  useEffect(() => {
    setDecimals(null)
    setMintErr('')
    let key: PublicKey
    try {
      key = new PublicKey(mint.trim())
    } catch {
      if (mint) setMintErr('Not a valid address')
      return
    }
    mintDecimals(connection, key)
      .then(setDecimals)
      .catch(() => setMintErr('Mint not found on this network'))
  }, [mint, connection])

  const settings = useMemo(() => {
    if (decimals === null) return null
    return {
      quoteMint: new PublicKey(mint.trim()),
      quoteDecimals: decimals,
      initialMcap: Number(initialMcap),
      migrationMcap: Number(migrationMcap),
      feeBps: Math.round(Number(feePct) * 100),
      creatorSharePct: Math.round(Number(creatorPct)),
      poolCreationFee: Number(launchFee) || 0,
    }
  }, [mint, decimals, initialMcap, migrationMcap, feePct, creatorPct, launchFee])

  const preview = useMemo(() => {
    if (!settings) return null
    try {
      if (!(settings.initialMcap > 0 && settings.migrationMcap > settings.initialMcap)) throw new Error('Graduation market cap must be above launch market cap')
      if (settings.feeBps < 25 || settings.feeBps > 9900) throw new Error('Fee must be between 0.25% and 99%')
      if (settings.creatorSharePct < 0 || settings.creatorSharePct > 100) throw new Error('Creator share must be 0–100%')
      const curve = buildCurve(settings)
      validateConfigParameters({ ...curve, leftoverReceiver: admin } as any)
      return { ok: true as const, threshold: Number(curve.migrationQuoteThreshold.toString()) / 10 ** settings.quoteDecimals }
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Invalid settings' }
    }
  }, [settings, admin])

  const create = async () => {
    if (!settings || !preview?.ok) return
    try {
      setBusy(true)
      const { tx, config } = await buildCreateConfigTx(connection, admin, settings)
      const sig = await send(tx)
      setCreated(config.toBase58())
      toast('ok', 'Launchpad config created', sig)
    } catch (e) {
      toast('err', errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  if (created)
    return (
      <div className="panel">
        <span className="tag tag-grad">Config created</span>
        <h2>Your launchpad config</h2>
        <div className="addr-box mono">{created}</div>
        <p className="dim">
          Set this as <code>VITE_DBC_CONFIG</code> in the Vercel project's environment variables and redeploy. The board, launch and trading
          pages go live right after.
        </p>
        <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(created)}>
          Copy address
        </button>
      </div>
    )

  return (
    <div className="launch-grid">
      <div className="panel">
        <label className="field">
          <span>$SVX mint address</span>
          <input className="input mono" value={mint} onChange={(e) => setMint(e.target.value)} placeholder="SVX token mint" />
          {mintErr ? <small className="down">{mintErr}</small> : decimals !== null && <small className="dim">{decimals} decimals ✓</small>}
        </label>
        <div className="row2">
          <label className="field">
            <span>Launch market cap (SVX)</span>
            <input className="input mono" value={initialMcap} onChange={(e) => setInitialMcap(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          <label className="field">
            <span>Graduation market cap (SVX)</span>
            <input className="input mono" value={migrationMcap} onChange={(e) => setMigrationMcap(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
        </div>
        <div className="row3">
          <label className="field">
            <span>Trading fee %</span>
            <input className="input mono" value={feePct} onChange={(e) => setFeePct(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          <label className="field">
            <span>Creator share of fee %</span>
            <input className="input mono" value={creatorPct} onChange={(e) => setCreatorPct(e.target.value.replace(/[^0-9]/g, ''))} />
          </label>
          <label className="field">
            <span>Launch fee (SVX)</span>
            <input className="input mono" value={launchFee} onChange={(e) => setLaunchFee(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
        </div>
        <p className="hint dim">
          These settings are permanent for this config. Every coin uses a fixed 1B supply, graduates to a Meteora DAMM v2 pool, and its LP is
          locked forever (split 50/50 between Solvex and the creator).
        </p>
        <button className="btn btn-primary btn-block" disabled={busy || !preview?.ok} onClick={create}>
          {busy ? 'Approve in wallet & confirming…' : 'Create launchpad config'}
        </button>
      </div>

      <aside className="panel preview">
        <span className="mono dim">Summary</span>
        {!preview ? (
          <p className="dim small">Enter the $SVX mint to preview the curve.</p>
        ) : !preview.ok ? (
          <p className="down small">{preview.error}</p>
        ) : (
          <>
            <div className="kv"><span className="dim">Graduates at</span><b className="mono">{compact(preview.threshold, 1)} SVX</b></div>
            <div className="kv"><span className="dim">Trading fee</span><span className="mono">{feePct}%</span></div>
            <div className="kv"><span className="dim">Creator gets</span><span className="mono">{creatorPct}% of fee</span></div>
            <div className="kv"><span className="dim">Fee claimer</span><span className="mono">{short(admin.toBase58())}</span></div>
            <p className="dim small">Costs a small amount of SOL for rent and network fees.</p>
          </>
        )}
      </aside>
    </div>
  )
}

function Live({ admin }: { admin: PublicKey }) {
  const { connection } = useConnection()
  const { lp } = useLaunchpad()
  const send = useSend()
  const toast = useToast()
  const [owed, setOwed] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const isClaimer = lp?.config.feeClaimer.equals(admin)

  const load = () => partnerFeesOwed(connection).then(setOwed).catch(() => setOwed(null))
  useEffect(() => {
    load()
  }, [connection])

  const claim = async () => {
    try {
      setBusy(true)
      const txs = await buildPartnerClaimTxs(connection, admin)
      if (!txs.length) return toast('info', 'Nothing to claim yet')
      for (const { tx } of txs) await send(tx)
      toast('ok', `Claimed fees from ${txs.length} pool${txs.length > 1 ? 's' : ''}`)
      load()
    } catch (e) {
      toast('err', errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  if (!lp) return <div className="coin skeleton tall" />
  return (
    <div className="launch-grid">
      <div className="panel">
        <b>Config</b>
        <div className="kv"><span className="dim">Address</span><a className="mono" href={explorerAddr(DBC_CONFIG!.toBase58())} target="_blank" rel="noreferrer">{short(DBC_CONFIG!.toBase58(), 6)}</a></div>
        <div className="kv"><span className="dim">Quote ($SVX)</span><span className="mono">{short(lp.quoteMint.toBase58(), 6)}</span></div>
        <div className="kv"><span className="dim">Graduates at</span><span className="mono">{compact(lp.thresholdSvx, 1)} SVX</span></div>
        <div className="kv"><span className="dim">Trading fee</span><span className="mono">{+lp.feePct.toFixed(2)}%</span></div>
        <div className="kv"><span className="dim">Creator share</span><span className="mono">{lp.creatorSharePct}%</span></div>
        <div className="kv"><span className="dim">Fee claimer</span><span className="mono">{short(lp.config.feeClaimer.toBase58(), 6)}</span></div>
      </div>
      <aside className="panel">
        <b>Platform fees</b>
        <p className="mono big-num">{owed === null ? '…' : `${compact(owed)} SVX`}</p>
        {isClaimer ? (
          <button className="btn btn-primary btn-block" disabled={busy || !owed} onClick={claim}>
            {busy ? 'Claiming…' : 'Claim all'}
          </button>
        ) : (
          <p className="dim small">Connect the fee-claimer wallet to claim.</p>
        )}
      </aside>
    </div>
  )
}
