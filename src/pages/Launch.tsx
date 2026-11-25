import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { buildLaunchTx, svxBalance } from '../lib/dbc'
import { DEMO } from '../lib/config'
import { errMsg, useSend } from '../lib/hooks'
import { fileToDataUrl, uploadMetadata } from '../lib/upload'
import { useToast } from '../components/Toast'
import { compact } from '../lib/format'

type Stage = 'idle' | 'upload' | 'sign' | 'confirm'
const STAGE_LABEL: Record<Stage, string> = {
  idle: 'Launch coin',
  upload: 'Uploading image…',
  sign: 'Approve in wallet & confirming…',
  confirm: 'Confirming…',
}

export default function Launch() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const { setVisible } = useWalletModal()
  const send = useSend()
  const toast = useToast()
  const nav = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [image, setImage] = useState<string>('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [twitter, setTwitter] = useState('')
  const [telegram, setTelegram] = useState('')
  const [website, setWebsite] = useState('')
  const [firstBuy, setFirstBuy] = useState('')
  const [more, setMore] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const [bal, setBal] = useState<number | null>(null)

  useEffect(() => {
    if (!publicKey || DEMO) return setBal(null)
    svxBalance(connection, publicKey).then(setBal).catch(() => setBal(null))
  }, [connection, publicKey])

  const onFile = async (f?: File) => {
    if (!f) return
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return toast('err', 'Use a PNG, JPG, GIF or WEBP image')
    if (f.size > 1_000_000) return toast('err', 'Image must be under 1 MB')
    setImage(await fileToDataUrl(f))
  }

  const buy = Number(firstBuy || 0)
  const valid = image && name.trim().length > 0 && name.length <= 32 && symbol.trim().length > 0 && symbol.length <= 10 && buy >= 0
  const busy = stage !== 'idle'

  const submit = async () => {
    if (!publicKey) return setVisible(true)
    if (!valid) return
    if (DEMO) return toast('info', 'Preview mode: set VITE_DBC_CONFIG and VITE_SVX_MINT to launch for real.')
    if (bal !== null && buy > bal) return toast('err', `First buy is more than your ${compact(bal)} SVX`)
    try {
      setStage('upload')
      const { uri } = await uploadMetadata({
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        description: description.trim(),
        image,
        twitter: twitter.trim(),
        telegram: telegram.trim(),
        website: website.trim(),
      })
      setStage('sign')
      const { tx, mint } = await buildLaunchTx(connection, publicKey, {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        uri,
        firstBuySvx: buy,
      })
      const sig = await send(tx)
      toast('ok', `$${symbol.toUpperCase()} is live`, sig)
      nav(`/coin/${mint.publicKey.toBase58()}`)
    } catch (e) {
      toast('err', errMsg(e))
    } finally {
      setStage('idle')
    }
  }

  return (
    <div className="wrap page launch">
      <div className="page-head">
        <div>
          <h1>Launch a coin</h1>
          <p className="dim">Priced in $SVX from the first trade. Graduates to Solana when the curve fills.</p>
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
            {image ? <img src={image} alt="" /> : <span>Drop an image or click to upload<br /><small className="dim">PNG, JPG, GIF, WEBP · max 1 MB</small></span>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </div>

          <div className="row2">
            <label className="field">
              <span>Name</span>
              <input className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ember Frog" />
            </label>
            <label className="field">
              <span>Ticker</span>
              <div className="input-prefix">
                <i>$</i>
                <input className="input" maxLength={10} value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/\s/g, '').toUpperCase())} placeholder="EFROG" />
              </div>
            </label>
          </div>

          <label className="field">
            <span>Description <small className="dim">optional</small></span>
            <textarea className="input" rows={3} maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's the coin about?" />
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

          <label className="field">
            <span>
              First buy <small className="dim">optional · in $SVX{bal !== null ? ` · balance ${compact(bal)}` : ''}</small>
            </span>
            <div className="input-suffix">
              <input className="input mono" inputMode="decimal" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
              <i>SVX</i>
            </div>
          </label>
          <p className="hint dim">The first buy happens in the same transaction as the launch, so nobody can buy before you.</p>

          <button className="btn btn-primary btn-block" disabled={!!publicKey && (!valid || busy)} onClick={submit}>
            {publicKey ? STAGE_LABEL[stage] : 'Connect wallet'}
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
          <ul className="checklist">
            <li>Fixed 1B supply, no mint authority</li>
            <li>Fair launch on a Meteora bonding curve</li>
            <li>You earn a share of every trading fee</li>
            <li>LP locked forever at graduation</li>
          </ul>
        </aside>
      </div>
    </div>
  )
}
