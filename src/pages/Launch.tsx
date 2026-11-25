import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { buildLaunch, fetchCoin, launchCaps, prepareSwap, quoteBalance } from '../lib/dbc'
import { GRAD_MCAP_USD, OPEN_MCAP_USD, WSOL_MINT } from '../lib/config'
import { errMsg, useAssets, useSubmit } from '../lib/hooks'
import { prepareImage, uploadMetadata } from '../lib/upload'
import { validateLaunch } from '../lib/validation'
import { useToast } from '../components/Toast'
import { AssetIcon, CoinImg } from '../components/Bits'
import { compact } from '../lib/format'

const STEPS = ['Coin', 'Pair', 'Review'] as const
const FEES = [
  [100, 'Lower friction'],
  [200, 'Balanced'],
  [300, 'Higher earnings'],
] as const

export default function Launch() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const { setVisible } = useWalletModal()
  const { assets, find, error: catalogError } = useAssets()
  const submit = useSubmit()
  const toast = useToast()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState(0)
  const [image, setImage] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [twitter, setTwitter] = useState('')
  const [telegram, setTelegram] = useState('')
  const [website, setWebsite] = useState('')
  const [pair, setPair] = useState(params.get('pair') || WSOL_MINT.toBase58())
  const [pairQ, setPairQ] = useState('')
  const [pairCat, setPairCat] = useState<'all' | 'crypto' | 'stock'>(params.get('pair') ? 'stock' : 'all')
  const [feeBps, setFeeBps] = useState(100)
  const [shield, setShield] = useState(true)
  const [dynamic, setDynamic] = useState(true)
  const [firstBuy, setFirstBuy] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [eligible, setEligible] = useState(false)
  const [status, setStatus] = useState('')
  const [bal, setBal] = useState<number | null>(null)
  const [caps, setCaps] = useState<{ initialCap: number; graduationCap: number; usd: number | null } | null>(null)
  const [capsErr, setCapsErr] = useState('')

  const asset = find(pair)
  const isStock = asset?.category === 'stock'
  const sym = asset?.symbol ?? 'pair'

  useEffect(() => {
    setCaps(null)
    setCapsErr('')
    launchCaps(pair).then(setCaps).catch((e) => setCapsErr(errMsg(e)))
  }, [pair])

  useEffect(() => {
    if (!publicKey) return setBal(null)
    quoteBalance(connection, publicKey, pair).then(setBal).catch(() => setBal(null))
  }, [connection, publicKey, pair])

  const pairs = useMemo(() => {
    const s = pairQ.trim().toLowerCase()
    return assets.filter((a) => (pairCat === 'all' || a.category === pairCat) && (!s || `${a.symbol} ${a.name}`.toLowerCase().includes(s))).slice(0, 60)
  }, [assets, pairQ, pairCat])

  let coinError = ''
  try {
    if (name || symbol) validateLaunch(name, symbol)
  } catch (e: any) {
    coinError = e.message
  }
  const coinOk = !!image && !!name.trim() && !!symbol && !coinError
  const pairOk = !!asset && !asset.halted && !!caps
  const buy = Number(firstBuy || 0)
  const canLaunch = coinOk && pairOk && agreed && (!isStock || eligible) && buy >= 0
  const busy = !!status

  const onFile = async (f?: File) => {
    if (!f) return
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return toast('err', 'Use a PNG, JPG, WEBP or GIF image')
    if (f.size > 10_000_000) return toast('err', 'Image must be under 10 MB')
    try {
      setImage(await prepareImage(f))
    } catch (e) {
      toast('err', errMsg(e))
    }
  }

  const launch = async () => {
    if (!publicKey) return setVisible(true)
    if (!canLaunch) return
    if (bal !== null && buy > bal) return toast('err', `Your first buy is more than your ${compact(bal)} ${sym}`)
    try {
      setStatus('Uploading image…')
      const { uri } = await uploadMetadata({ address: publicKey.toBase58(), name: name.trim(), symbol, description: description.trim(), image, twitter: twitter.trim(), telegram: telegram.trim(), website: website.trim() })
      setStatus('Preparing launch…')
      const { tx, signers, mint } = await buildLaunch(connection, publicKey, { quoteMint: pair, name: name.trim(), symbol, uri, feeBps, dynamic, shield })
      const sig = await submit(tx, signers, setStatus)
      toast('ok', `$${symbol} launched`, sig)
      if (buy > 0) {
        setStatus('Preparing your first buy…')
        try {
          let coin = null
          for (let i = 0; i < 8 && !coin; i++) {
            coin = await fetchCoin(connection, mint)
            if (!coin) await new Promise((r) => setTimeout(r, 1500))
          }
          if (!coin) throw new Error('the market isn’t visible yet, so buy from the coin page')
          const p = await prepareSwap(connection, coin, 'buy', firstBuy, 500, publicKey)
          const bsig = await submit(p.tx, [], setStatus)
          toast('ok', `Bought ${compact(p.out)} $${symbol}`, bsig)
        } catch (e) {
          toast('err', `Launched, but the first buy didn’t go through: ${errMsg(e)}`)
        }
      }
      nav(`/coin/${mint}`)
    } catch (e) {
      toast('err', errMsg(e))
    } finally {
      setStatus('')
    }
  }

  const goStep = (n: number) => {
    if (n > 0 && !coinOk) return toast('err', coinError || 'Add an image, a name and a ticker first')
    if (n > 1 && !pairOk) return toast('err', capsErr || 'Choose an available pair first')
    setStep(n)
  }

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>Launch a coin</h1>
          <p>One transaction creates your coin, its bonding curve and its market.</p>
        </div>
      </div>

      <div className="studio">
        <div>
          <div className="stepper">
            {STEPS.map((s, i) => (
              <button key={s} className={i === step ? 'on' : i < step ? 'done' : ''} onClick={() => goStep(i)}>
                <i>{i < step ? '✓' : i + 1}</i>
                <span>{s}</span>
              </button>
            ))}
          </div>

          <div className="surface pad stack studio-body">
            {step === 0 && (
              <>
                <h2>Your coin</h2>
                <div
                  className={`drop ${image ? 'has' : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    onFile(e.dataTransfer.files[0])
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
                >
                  {image ? (
                    <div className="drop-preview">
                      <img src={image} alt="Coin image" />
                      <span>
                        <b>Image ready</b>
                        <br />
                        <span className="muted small">Click or drop a file to replace it</span>
                      </span>
                    </div>
                  ) : (
                    <span>
                      <b>Drop an image or click to choose</b>
                      <br />
                      <span className="muted small">PNG, JPG, WEBP or GIF up to 10 MB. It’s cropped to a square.</span>
                    </span>
                  )}
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                </div>
                <div className="grid2">
                  <label className="field">
                    Name
                    <input className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Flip Frog" />
                  </label>
                  <label className="field">
                    Ticker
                    <div className="affix">
                      <i className="pre">$</i>
                      <input className="input" maxLength={10} value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())} placeholder="FROG" />
                    </div>
                  </label>
                </div>
                {coinError && <div className="err">{coinError}</div>}
                <label className="field">
                  <span>
                    Description <small>optional</small>
                  </span>
                  <textarea className="input" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What’s the coin about?" />
                </label>
                <div className="grid3">
                  <label className="field">
                    <span>
                      X <small>optional</small>
                    </span>
                    <input className="input" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="https://x.com/…" />
                  </label>
                  <label className="field">
                    <span>
                      Telegram <small>optional</small>
                    </span>
                    <input className="input" value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="https://t.me/…" />
                  </label>
                  <label className="field">
                    <span>
                      Website <small>optional</small>
                    </span>
                    <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
                  </label>
                </div>
                <div className="studio-nav">
                  <span />
                  <button className="btn btn-primary" onClick={() => goStep(1)}>
                    Choose a pair
                  </button>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h2>Choose a pair</h2>
                <p className="muted">Traders buy your coin with this asset, and your trading fees are paid in it.</p>
                <div className="toolbar" style={{ marginBottom: 0 }}>
                  <div className="seg">
                    {(['all', 'crypto', 'stock'] as const).map((c) => (
                      <button key={c} className={pairCat === c ? 'on' : ''} onClick={() => setPairCat(c)}>
                        {c === 'all' ? 'All' : c === 'crypto' ? 'Crypto' : 'Tokenized stocks'}
                      </button>
                    ))}
                  </div>
                  <label className="search">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input className="input" placeholder="Search SOL, USDC, NVDAx…" value={pairQ} onChange={(e) => setPairQ(e.target.value)} aria-label="Search pairs" />
                  </label>
                </div>
                {catalogError && <div className="note">{catalogError}</div>}
                <div className="pair-list" role="listbox">
                  {pairs.map((a) => (
                    <button key={a.mint} role="option" aria-selected={pair === a.mint} className={`pair-opt ${pair === a.mint ? 'on' : ''}`} disabled={a.halted} onClick={() => setPair(a.mint)}>
                      <AssetIcon asset={a} size={34} />
                      <span className="grow">
                        <b>{a.symbol}</b>
                        <small>{a.name}</small>
                      </span>
                      <span className={`badge ${a.category === 'stock' ? 'grad' : ''}`}>{a.halted ? 'Halted by issuer' : a.category === 'stock' ? 'Tokenized stock' : 'Crypto'}</span>
                    </button>
                  ))}
                  {!pairs.length && <div className="empty"><p>No pair matches that search.</p></div>}
                </div>
                {isStock && (
                  <div className="note">
                    {asset?.symbol} is a tokenized stock from xStocks, not a brokerage share. Pairing with it doesn’t mean your coin is backed by the stock. Issuer
                    terms and regional restrictions apply.{' '}
                    <a href="https://assets.backed.fi/legal-documentation" target="_blank" rel="noreferrer">
                      Read the issuer terms
                    </a>
                  </div>
                )}
                {capsErr && <div className="err">{capsErr}</div>}
                <div className="studio-nav">
                  <button className="btn btn-ghost" onClick={() => setStep(0)}>
                    Back
                  </button>
                  <button className="btn btn-primary" disabled={!pairOk} onClick={() => goStep(2)}>
                    Review launch
                  </button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2>Fees and review</h2>
                <div className="field">
                  Trading fee
                  <div className="fee-choice">
                    {FEES.map(([f, l]) => (
                      <button key={f} className={feeBps === f ? 'on' : ''} onClick={() => setFeeBps(f)}>
                        <b>{f / 100}%</b>
                        <span>{l}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={shield} onChange={(e) => setShield(e.target.checked)} />
                  <div>
                    <b>Anti-snipe fee</b>
                    <span>Starts at 10% and falls to {feeBps / 100}% over the first 5 minutes, so bots pay more for the first buys.</span>
                  </div>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={dynamic} onChange={(e) => setDynamic(e.target.checked)} />
                  <div>
                    <b>Volatility fee</b>
                    <span>Adds a small extra fee during sharp price swings.</span>
                  </div>
                </label>
                <label className="field">
                  <span>
                    First buy <small>optional, in {sym}{bal !== null ? `. You have ${compact(bal)}` : ''}</small>
                  </span>
                  <div className="affix">
                    <input className="input" inputMode="decimal" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
                    <i className="post">{sym}</i>
                  </div>
                </label>

                <dl className="review">
                  <div><dt>Coin</dt><dd>{name || '—'} (${symbol || '—'})</dd></div>
                  <div><dt>Pair</dt><dd>{sym}</dd></div>
                  <div><dt>Supply</dt><dd>1,000,000,000, fixed</dd></div>
                  <div><dt>Mint authority</dt><dd>Revoked at launch</dd></div>
                  <div><dt>Opening market cap</dt><dd>${compact(OPEN_MCAP_USD, 0)}{caps ? ` (${compact(caps.initialCap)} ${sym})` : ''}</dd></div>
                  <div><dt>Graduates at</dt><dd>${compact(GRAD_MCAP_USD, 0)}{caps ? ` (${compact(caps.graduationCap)} ${sym})` : ''}</dd></div>
                  <div><dt>Trading fee</dt><dd>{shield ? '10% falling to ' : ''}{feeBps / 100}%{dynamic ? ' plus volatility fee' : ''}</dd></div>
                  <div><dt>Fee split</dt><dd>50% you, 50% Solvex</dd></div>
                </dl>
                <p className="muted small">Network fees and account rent are paid in SOL. Everything is created in one transaction, which is simulated before your wallet asks you to sign.</p>
                <label className="check">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>I understand a launch is permanent and memecoins can lose all their value.</span>
                </label>
                {isStock && (
                  <label className="check">
                    <input type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} />
                    <span>I’m eligible to hold {sym} under the xStocks issuer terms.</span>
                  </label>
                )}
                <div className="studio-nav">
                  <button className="btn btn-ghost" onClick={() => setStep(1)} disabled={busy}>
                    Back
                  </button>
                  <button className="btn btn-primary" disabled={!!publicKey && (!canLaunch || busy)} onClick={launch}>
                    {!publicKey ? 'Connect wallet' : status || `Launch $${symbol || 'coin'}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <aside className="surface preview-card">
          <div className="preview-top">
            <CoinImg coin={{ image, symbol: symbol || '?' }} size={64} />
            <div>
              <b>${symbol || 'TICKER'}</b>
              <span>{name || 'Your coin'}</span>
            </div>
          </div>
          <div className="preview-body">
            <p className="muted small">{description || 'Your description shows here.'}</p>
            <div className="kv">
              <span>Pair</span>
              <b style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <AssetIcon mint={pair} size={18} /> {sym}
              </b>
            </div>
            <div className="kv">
              <span>Opens at</span>
              <b>${compact(OPEN_MCAP_USD, 0)}</b>
            </div>
            <div className="kv">
              <span>Graduates at</span>
              <b>${compact(GRAD_MCAP_USD, 0)}</b>
            </div>
            <div className="kv">
              <span>Trading fee</span>
              <b>{feeBps / 100}%</b>
            </div>
            <div className="kv">
              <span>Liquidity after graduation</span>
              <b>Locked forever</b>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
