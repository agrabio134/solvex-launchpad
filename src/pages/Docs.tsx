import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const SECTIONS: { id: string; title: string; body: string[] }[] = [
  {
    id: 'overview',
    title: 'Overview',
    body: [
      'Solvex is a memecoin launchpad powered entirely by $SVX. Every coin launched here is paired against $SVX, so every trade on the platform runs through one token.',
      'Coins are created on Meteora’s Dynamic Bonding Curve (DBC) program. Solvex owns one DBC config that sets the rules every coin follows: curve shape, fees and graduation target.',
    ],
  },
  {
    id: 'launch',
    title: 'Launching a coin',
    body: [
      'Connect a wallet, open Launch, and add an image, a name (up to 32 characters) and a ticker (up to 10). Socials and a description are optional.',
      'The image and metadata are pinned to IPFS, then a single transaction creates the mint and the curve. If you set a first buy, it executes in that same transaction, so nobody can buy ahead of you.',
      'Every coin has a fixed 1,000,000,000 supply and no mint authority.',
    ],
  },
  {
    id: 'trading',
    title: 'Trading on the curve',
    body: [
      'Buying sends $SVX into the curve and moves the price up; selling returns $SVX and moves it down. Quotes include the trading fee and your slippage limit; if the price moves past it, the transaction fails instead of filling at a worse price.',
    ],
  },
  {
    id: 'fees',
    title: 'Fees',
    body: [
      'A trading fee is charged in $SVX on every trade. Part goes to the coin’s creator, part to Solvex, and a share to Meteora’s protocol.',
      'Creators claim their fees anytime from My coins or the coin page.',
    ],
  },
  {
    id: 'graduation',
    title: 'Graduation',
    body: [
      'When the curve has collected its graduation target in $SVX, trading on the curve stops. Meteora’s migration keeper moves the liquidity into a DAMM v2 pool on Solana.',
      'The LP from graduation is permanently locked. From then on the coin trades on Jupiter and every Solana aggregator, still paired with $SVX.',
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
