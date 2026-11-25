import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { GRAD_MCAP_USD, OPEN_MCAP_USD } from '../lib/config'
import { compact } from '../lib/format'

const SECTIONS: { id: string; title: string; body: string[] }[] = [
  {
    id: 'overview',
    title: 'Overview',
    body: [
      'Solvex is a memecoin launchpad on Solana built on Meteora’s Dynamic Bonding Curve. Every launch creates its own curve settings and market in one transaction, with the Solvex platform wallet as fee partner.',
      'You choose what your coin trades against: SOL, USDC, or a tokenized stock or ETF from xStocks. $FLIP, the Solvex token, joins the list of pairs when it launches.',
    ],
  },
  {
    id: 'launch',
    title: 'Launching a coin',
    body: [
      'Add an image (cropped to a square and resized in your browser), a name of up to 32 bytes and a ticker of 2–10 letters or digits. Socials and a description are optional.',
      'Pick a pair, a 1–3% trading fee and optional protections. One transaction creates the mint, the curve settings and the market, and it’s simulated on mainnet before your wallet asks you to sign. An optional first buy follows straight after.',
      'Every coin has a fixed 1,000,000,000 supply with the mint authority revoked.',
    ],
  },
  {
    id: 'pairs',
    title: 'Stock pairs',
    body: [
      'A stock pair means traders buy your coin with a tokenized stock such as NVDAx, and your fees are paid in it. It doesn’t make your coin backed by that stock.',
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
      'Trading fees are paid in the pair asset. After Meteora’s protocol share, the creator gets 50% and Solvex gets 50%. Creators claim from their Portfolio or the coin page at any time.',
      'The optional anti-snipe fee starts at 10% and falls to the chosen fee over the first 5 minutes. The optional volatility fee adds a small amount during sharp price swings.',
    ],
  },
  {
    id: 'graduation',
    title: 'Graduation',
    body: [
      `Coins open near a $${compact(OPEN_MCAP_USD, 0)} market cap and graduate near $${compact(GRAD_MCAP_USD, 0)}, converted into the pair asset at its price when the coin launches. When the curve is full, anyone can press Migrate on the coin page to move the liquidity into a Meteora DAMM v2 pool.`,
      'That liquidity is locked forever, split between the creator and Solvex, who both keep earning its trading fees. Trading continues on the same page and on Jupiter.',
    ],
  },
  {
    id: 'risk',
    title: 'Risk',
    body: ['Memecoins are extremely volatile and most lose their value. Nothing on Solvex is financial advice. Only use what you can afford to lose.'],
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
