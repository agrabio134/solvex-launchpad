import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const SECTIONS: { id: string; title: string; body: string[] }[] = [
  {
    id: 'overview',
    title: 'Overview',
    body: [
      'Flip is a memecoin launchpad on Solana built on pump.fun. Every coin launched here is a real pump.fun coin: it trades on the pump.fun bonding curve, shows up on pump.fun, and graduates to PumpSwap.',
      'You choose what your coin trades against: SOL, USDC, or a tokenized stock that pump.fun accepts as a pair. Whatever the pair, anyone can buy and sell with SOL.',
    ],
  },
  {
    id: 'launch',
    title: 'Launching a coin',
    body: [
      'Add an image (cropped to a square and resized in your browser), a name of up to 32 bytes and a ticker of 2–10 letters or digits. Socials and a description are optional.',
      'Pick a pair. One transaction creates the coin and its pump.fun bonding curve, and it’s simulated on mainnet before your wallet asks you to sign. On a SOL pair your optional first buy goes in the same transaction; on other pairs it follows straight after, paid in SOL.',
      'Every coin has a fixed 1,000,000,000 supply with the mint authority revoked. Coins are Token-2022 mints, as pump.fun creates them.',
    ],
  },
  {
    id: 'pairs',
    title: 'Stock pairs',
    body: [
      'A stock pair means the curve is priced in a tokenized stock such as NVDAx, and your creator fees are paid in it. It doesn’t make your coin backed by that stock. Traders can still pay with SOL: Flip swaps it through Jupiter in the same transaction.',
      'Tokenized stocks are issued by xStocks. They are not brokerage shares, and issuer terms and regional restrictions apply. Launching or trading against one asks you to confirm you’re eligible.',
    ],
  },
  {
    id: 'trading',
    title: 'Trading on the curve',
    body: [
      'Buying moves the price up the curve and selling moves it down. Quotes include the trading fee, and your slippage setting caps how far the price can move before the trade is refused instead of filled at a worse price.',
    ],
  },
  {
    id: 'fees',
    title: 'Fees',
    body: [
      'Trades pay pump.fun’s standard fees, in the pair asset. Part of every fee goes to the coin’s creator, on the curve and after graduation. Flip adds no fee of its own.',
      'Creator fees collect in your pump.fun creator vault. Claim them from your Portfolio or the coin page at any time; one claim pays out every coin you launched in that pair asset.',
    ],
  },
  {
    id: 'graduation',
    title: 'Graduation',
    body: [
      'When the last tokens on the curve are bought, the curve completes. pump.fun then moves the liquidity into a PumpSwap pool automatically, usually within a minute.',
      'After that, trades on the coin page route through PumpSwap via Jupiter. The coin also trades on pump.fun and anywhere Jupiter is available.',
    ],
  },
  {
    id: 'risk',
    title: 'Risk',
    body: ['Memecoins are extremely volatile and most lose their value. Nothing on Flip is financial advice. Only use what you can afford to lose.'],
  },
]

export default function Docs() {
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hash])
  return (
    <div className="wrap page docs">
      <nav className="docs-nav" aria-label="Docs sections">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.title}
          </a>
        ))}
      </nav>
      <article>
        <h1>Docs</h1>
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id}>
            <h2>{s.title}</h2>
            {s.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>
        ))}
      </article>
    </div>
  )
}
