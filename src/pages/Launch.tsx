import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { buildLaunch, fetchCoin, launchCaps, prepareSwap, svxBalance } from '../lib/dbc'
import { GRAD_MCAP_USD, OPEN_MCAP_USD, Q } from '../lib/config'
import { errMsg, useSubmit } from '../lib/hooks'
import { fileToDataUrl, uploadMetadata } from '../lib/upload'
import { validateLaunch } from '../lib/validation'
import { useToast } from '../components/Toast'
import { compact } from '../lib/format'

const FEES = [100, 200, 300]

export default function Launch() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const { setVisible } = useWalletModal()
  const submit = useSubmit()
  const toast = useToast()
  const nav = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [image, setImage] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [twitter, setTwitter] = useState('')
  const [telegram, setTelegram] = useState('')
  const [website, setWebsite] = useState('')
  const [feeBps, setFeeBps] = useState(100)
  const [dynamic, setDynamic] = useState(true)
  const [shield, setShield] = useState(true)
  const [firstBuy, setFirstBuy] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [more, setMore] = useState(false)
  const [status, setStatus] = useState('')
  const [bal, setBal] = useState<number | null>(null)
  const [caps, setCaps] = useState<{ initialCap: number; graduationCap: number; usd: number | null } | null>(null)
  const [capsErr, setCapsErr] = useState('')

  useEffect(() => {
    if (!publicKey) return setBal(null)
    svxBalance(connection, publicKey).then(setBal).catch(() => setBal(null))
  }, [connection, publicKey])

  useEffect(() => {
    launchCaps().then(setCaps).catch((e) => setCapsErr(e.message))
  }, [])

  const onFile = async (f?: File) => {
    if (!f) return
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return toast('err', 'Use a PNG, JPG, WEBP or GIF image')
    if (f.size > 1_000_000) return toast('err', 'Image must be under 1 MB')
    setImage(await fileToDataUrl(f))
  }

  const buy = Number(firstBuy || 0)
  let formError = ''
  try {
    if (name || symbol) validateLaunch(name, symbol)
  } catch (e: any) {
    formError = e.message
  }
  const valid = !!image && !!name && !!symbol && !formError && agreed && buy >= 0
  const busy = !!status

  const go = async () => {
    if (!publicKey) return setVisible(true)
    if (!valid) return
    if (bal !== null && buy > bal) return toast('err', `First buy is more than your ${compact(bal)} ${Q}`)
    try {
      setStatus('Uploading image…')
      const { uri } = await uploadMetadata({
        address: publicKey.toBase58(),
        name: name.trim(),
        symbol,
        description: description.trim(),
        image,
        twitter: twitter.trim(),
        telegram: telegram.trim(),
        website: website.trim(),
      })
      setStatus('Preparing launch…')
      const { tx, signers, mint } = await buildLaunch(connection, publicKey, { name: name.trim(), symbol, uri, feeBps, dynamic, shield })
      const sig = await submit(tx, signers, setStatus)
      toast('ok', `$${symbol} is live`, sig)
      if (buy > 0) {
        setStatus('Preparing your first buy…')
        try {
          let coin = null
          for (let i = 0; i < 8 && !coin; i++) {
            coin = await fetchCoin(connection, mint)
            if (!coin) await new Promise((r) => setTimeout(r, 1500))
          }
          if (!coin) throw new Error('market not visible yet, buy from the coin page')
          const p = await prepareSwap(connection, coin, 'buy', firstBuy, 500, publicKey)
          const bsig = await submit(p.tx, [], setStatus)
          toast('ok', `Bought ${compact(p.out)} $${symbol}`, bsig)
        } catch (e) {
          toast('err', `Launched, but the first buy failed: ${errMsg(e)}`)
        }
      }
      nav(`/coin/${mint}`)
    } catch (e) {
      toast('err', errMsg(e))
    } finally {
      setStatus('')
    }
  }

  return (
    <div className="wrap page launch">
      <div className="page-head">
        <div>
          <h1>Launch a coin</h1>
          <p className="dim">Priced in {Q} from the first trade. Graduates to a locked Meteora pool on Solana when the curve fills.</p>
        </div>
      </div>

      <div className="launch-grid">
        <div className="panel">
          <div
            className={`drop ${image ? 'has' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              onFile(e.dataTransfer.files[0])
            }}
          >
            {image ? (
              <img src={image} alt="" />
            ) : (
              <span>
                Drop an image or click to upload
                <br />
                <small className="dim">PNG, JPG, WEBP, GIF · max 1 MB</small>
              </span>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </div>

          <div className="row2">
            <label className="field">
              <span>Name</span>
              <input className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Flip Frog" />
            </label>
            <label className="field">
              <span>Ticker</span>
              <div className="input-prefix">
                <i>$</i>
                <input className="input" maxLength={10} value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())} placeholder="FROG" />
              </div>
            </label>
          </div>
          {formError && <small className="down">{formError}</small>}

          <label className="field">
            <span>
              Description <small className="dim">optional</small>
            </span>
            <textarea className="input" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's the coin about?" />
          </label>

          <button className="link-btn" onClick={() => setMore((m) => !m)}>
            {more ? '− Hide socials' : '+ Add socials'}
          </button>
          {more && (
            <div className="row3">
              <label className="field">
                <span>X</span>
                <input className="input" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="https://x.com/…" />
              </label>
              <label className="field">
                <span>Telegram</span>
                <input className="input" value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="https://t.me/…" />
              </label>
              <label className="field">
                <span>Website</span>
                <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
              </label>
            </div>
          )}

          <div className="field">
            <span>Trading fee</span>
            <div className="seg">
              {FEES.map((f) => (
                <button key={f} className={feeBps === f ? 'on' : ''} onClick={() => setFeeBps(f)}>
                  {f / 100}%
                </button>
              ))}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={shield} onChange={(e) => setShield(e.target.checked)} />
            <span>
              <b>Anti-snipe shield</b> <small className="dim">fee starts at 10% and falls to {feeBps / 100}% over the first 5 minutes</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={dynamic} onChange={(e) => setDynamic(e.target.checked)} />
            <span>
              <b>Dynamic fee</b> <small className="dim">adds a small extra fee during sharp price swings</small>
            </span>
          </label>

          <label className="field">
            <span>
              First buy <small className="dim">optional · in {Q}{bal !== null ? ` · balance ${compact(bal)}` : ''}</small>
            </span>
            <div className="input-suffix">
              <input className="input mono" inputMode="decimal" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
              <i>{Q}</i>
            </div>
          </label>

          <label className="check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span className="small">I understand launches are permanent and memecoins can lose all value.</span>
          </label>

          <button className="btn btn-primary btn-block" disabled={!!publicKey && (!valid || busy)} onClick={go}>
            {!publicKey ? 'Connect wallet' : status || 'Launch coin'}
          </button>
        </div>

        <aside className="panel preview">
          <span className="mono dim">Preview</span>
          <div className="preview-card">
            {image ? <img src={image} alt="" /> : <div className="avatar-ph big">?</div>}
            <div>
              <b>${symbol || 'TICKER'}</b>
              <div className="dim">{name || 'Coin name'}</div>
            </div>
          </div>
          <p className="dim small">{description || 'Your description shows here.'}</p>
          <div className="kv">
            <span className="dim">Opening market cap</span>
            <span className="mono">${compact(OPEN_MCAP_USD, 0)}</span>
          </div>
          <div className="kv">
            <span className="dim">Graduates at</span>
            <span className="mono">${compact(GRAD_MCAP_USD, 0)}</span>
          </div>
          {caps && (
            <p className="dim small mono">
              ≈ {compact(caps.initialCap)} → {compact(caps.graduationCap)} {Q}{caps.usd ? ` at $${caps.usd.toPrecision(3)}` : ''}
            </p>
          )}
          {capsErr && <p className="down small">{capsErr}</p>}
          <ul className="checklist">
            <li>Fixed 1B supply, no mint authority</li>
            <li>Fair launch on a Meteora bonding curve</li>
            <li>You earn 50% of trading fees</li>
            <li>LP locked forever at graduation</li>
          </ul>
        </aside>
      </div>
    </div>
  )
}
