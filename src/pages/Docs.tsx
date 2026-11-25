import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const SECTIONS: { id: string; title: string; body: string[] }[] = [
  {
    id: 'overview',
    title: 'Overview',
    body: [
      'Solvex is a memecoin launchpad powered by $FLIP. Every coin launched here is paired against the launchpad currency, so every trade on the platform runs through one token.',
      'Until $FLIP launches, markets are paired with SOL. Once $FLIP is live, new launches are paired with $FLIP.',
      'Coins are created on Meteora’s Dynamic Bonding Curve (DBC) program. Each launch creates its own curve config and market in one transaction, paired with $FLIP, with the Solvex platform wallet as fee partner.',
    ],
  },
  {
    id: 'launch',
    title: 'Launching a coin',
    body: [
      'Connect a wallet, open Launch, and add an image, a name (up to 32 characters) and a ticker (up to 10). Socials and a description are optional.',
      'The image and metadata are stored, then one transaction creates the mint, the curve config and the market. Every transaction is simulated on mainnet before your wallet is asked to sign. An optional first buy follows right after, and the optional anti-snipe shield starts the fee at 10% and lowers it to your chosen fee over 5 minutes.',
      'Every coin has a fixed 1,000,000,000 supply and no mint authority.',
    ],
  },
  {
    id: 'trading',
    title: 'Trading on the curve',
    body: [
      'Buying sends $FLIP into the curve and moves the price up; selling returns $FLIP and moves it down. Quotes include the trading fee and your slippage limit; if the price moves past it, the transaction fails instead of filling at a worse price.',
    ],
  },
  {
    id: 'fees',
    title: 'Fees',
    body: [
      'Creators pick a 1–3% trading fee, charged in $FLIP. After Meteora’s protocol share, the creator gets 50% and Solvex gets 50%.',
      'Creators claim their fees anytime from My coins or the coin page.',
    ],
  },
  {
    id: 'graduation',
    title: 'Graduation',
    body: [
      'Every coin opens at about a $4K market cap and graduates at about $35K, converted to $FLIP at launch. When the curve is full, anyone can press Migrate on the coin page to move the liquidity into a Meteora DAMM v2 pool on Solana.',
      'The LP from graduation is permanently locked, split between the creator and Solvex, who both keep earning its trading fees. Trading continues on the same coin page and on Jupiter.',
    ],
  },
  {
    id: 'risk',
    title: 'Risk',
    body: ['Memecoins are extremely volatile and most lose all value. Nothing on Solvex is financial advice. Never trade more than you can afford to lose.'],
  },
]

export default function Docs() {
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hash])

  return (
    <div className="wrap page docs">
      <aside className="docs-nav">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.title}
          </a>
        ))}
      </aside>
      <article>
        <h1>Docs</h1>
        {SECTIONS.map((s, i) => (
          <section key={s.id} id={s.id}>
            <h2>
              <span className="mono dim">{String(i + 1).padStart(2, '0')}</span> {s.title}
            </h2>
            {s.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>
        ))}
      </article>
    </div>
  )
}
