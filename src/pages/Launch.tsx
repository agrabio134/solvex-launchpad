import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { buildLaunch, fetchCoin, fetchPairMints, prepareSwap, quoteBalance, registerCoin } from '../lib/chain'
import { WSOL_MINT } from '../lib/config'
import { errMsg, useAssets, useSubmit } from '../lib/hooks'
import { prepareImage, uploadMetadata } from '../lib/upload'
import { validateLaunch } from '../lib/validation'
import { useToast } from '../components/Toast'
import { AssetIcon, CoinImg } from '../components/Bits'
import { compact } from '../lib/format'

const STEPS = ['Coin', 'Pair', 'Review'] as const
/** Rent for the mint, bonding curve and token accounts plus network fees, with headroom. */
const LAUNCH_SOL = 0.03

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
  const [firstBuy, setFirstBuy] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [eligible, setEligible] = useState(false)
  const [status, setStatus] = useState('')
  const [bal, setBal] = useState<number | null>(null)
  const [supported, setSupported] = useState<Set<string> | null>(null)
  const [pairsErr, setPairsErr] = useState('')

  const asset = find(pair)
  const isStock = asset?.category === 'stock'
  const sym = asset?.symbol ?? 'pair'

  useEffect(() => {
    fetchPairMints(connection)
      .then(setSupported)
      .catch((e) => setPairsErr(`Couldn’t read pump.fun’s list of pair assets: ${errMsg(e)}`))
  }, [connection])
  const pairIsSol = pair === WSOL_MINT.toBase58()

  useEffect(() => {
    if (!publicKey) return setBal(null)
    quoteBalance(connection, publicKey, WSOL_MINT.toBase58()).then(setBal).catch(() => setBal(null))
  }, [connection, publicKey])

  const pairs = useMemo(() => {
    const s = pairQ.trim().toLowerCase()
    return assets
      .filter((a) => (!supported || supported.has(a.mint)) && (pairCat === 'all' || a.category === pairCat) && (!s || `${a.symbol} ${a.name}`.toLowerCase().includes(s)))
      .slice(0, 60)
  }, [assets, pairQ, pairCat, supported])

  // each field is checked once it has something in it, so typing a name doesn't flag the empty ticker
  let coinError = ''
  if (name && new TextEncoder().encode(name.trim()).length > 32) coinError = 'Name must be at most 32 bytes.'
  else if (symbol.length > 1 && !/^[A-Z0-9]{2,10}$/.test(symbol)) coinError = 'Ticker: 2–10 uppercase letters or digits.'
  if (!coinError && name && symbol.length > 1) {
    try {
      validateLaunch(name, symbol)
    } catch (e: any) {
      coinError = e.message
    }
  }
  const coinOk = !!image && !!name.trim() && symbol.length > 1 && !coinError
  const pairOk = !!asset && !asset.halted && !!supported?.has(pair)
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
    try {
      const lamports = await connection.getBalance(publicKey)
      const needSol = LAUNCH_SOL + buy + (buy ? 0.01 : 0)
      if (lamports / 1e9 < needSol)
        return toast('err', `Not enough SOL. Launching needs about ${LAUNCH_SOL} SOL for rent and network fees${buy ? `, plus your ${buy} SOL first buy` : ''}. Your wallet has ${(lamports / 1e9).toFixed(4)} SOL.`)
    } catch (e) {
      return toast('err', errMsg(e))
    }
    try {
      setStatus('Uploading image…')
      const { uri } = await uploadMetadata({ address: publicKey.toBase58(), name: name.trim(), symbol, description: description.trim(), image, twitter: twitter.trim(), telegram: telegram.trim(), website: website.trim() })
      setStatus('Preparing launch…')
      // create and first buy don't fit one Solana transaction together, so the first buy follows right after
      const { tx, signers, mint } = await buildLaunch(connection, publicKey, { quoteMint: pair, name: name.trim(), symbol, uri })
      const sig = await submit(tx, signers, setStatus, 'launch')
      toast('ok', `$${symbol} launched`, sig)
      setStatus('Adding it to Flip…')
      if (!(await registerCoin(mint, sig))) toast('err', 'Your coin is live on pump.fun, but Flip couldn’t list it yet. Refresh in a minute.')
      if (buy > 0) {
        setStatus('Preparing your first buy…')
        try {
          let coin = null
          for (let i = 0; i < 8 && !coin; i++) {
            coin = await fetchCoin(connection, mint)
            if (!coin) await new Promise((r) => setTimeout(r, 1500))
          }
          if (!coin) throw new Error('the market isn’t visible yet, so buy from the coin page')
          const p = await prepareSwap(connection, coin, 'buy', firstBuy, 500, publicKey, 'sol')
          const bsig = await submit(p.tx, [], setStatus, p.budget, p.luts)
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
    if (n > 0 && !coinOk) return toast('err', coinError || (symbol.length === 1 ? 'Ticker: 2–10 uppercase letters or digits.' : 'Add an image, a name and a ticker first'))
    if (n > 1 && !pairOk) return toast('err', pairsErr || 'Choose an available pair first')
    setStep(n)
  }

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>Launch a coin</h1>
          <p>One transaction creates your coin on pump.fun with its bonding curve. It trades here straight away.</p>
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
                    <input className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Moon Frog" />
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
                <p className="muted small">Only pair assets pump.fun accepts for new coins are listed. Traders can still buy and sell any coin with SOL.</p>
                {catalogError && <div className="note">{catalogError}</div>}
                {!supported && !pairsErr && <div className="note">Loading the pairs pump.fun accepts…</div>}
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
                  {supported && !pairs.length && <div className="empty"><p>No pair matches that search.</p></div>}
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
                {pairsErr && <div className="err">{pairsErr}</div>}
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
                <h2>Review</h2>
                <label className="field">
                  <span>
                    First buy <small>optional, in SOL, made right after launch{pairIsSol ? '' : ` (swapped to ${sym} for you)`}{bal !== null ? `. You can spend ${compact(bal)} SOL` : ''}</small>
                  </span>
                  <div className="affix">
                    <input className="input" inputMode="decimal" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
                    <i className="post">SOL</i>
                  </div>
                </label>

                <dl className="review">
                  <div><dt>Coin</dt><dd>{name || '—'} (${symbol || '—'})</dd></div>
                  <div><dt>Pair</dt><dd>{sym}</dd></div>
                  <div><dt>Supply</dt><dd>1,000,000,000, fixed</dd></div>
                  <div><dt>Mint authority</dt><dd>Revoked at launch</dd></div>
                  <div><dt>Bonding curve</dt><dd>pump.fun</dd></div>
                  <div><dt>Graduates to</dt><dd>PumpSwap, automatically when the curve completes</dd></div>
                </dl>
                <p className="muted small">Network fees and account rent (about 0.02 SOL) are paid in SOL. The launch is simulated before your wallet asks you to sign.</p>
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
              <span>Curve</span>
              <b>pump.fun</b>
            </div>
            <div className="kv">
              <span>Graduates to</span>
              <b>PumpSwap</b>
            </div>
            <div className="kv">
              <span>Tradable with</span>
              <b>SOL{pairIsSol ? '' : ` or ${sym}`}</b>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
