import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAssets, useCoins, useUsdMany } from '../lib/hooks'
import { GRAD_MCAP_USD, OPEN_MCAP_USD } from '../lib/config'
import { ago, compact } from '../lib/format'
import { AssetIcon, CoinImg, MarketHead, MarketRow, PairTag, usd } from '../components/Bits'

const FAQ: [string, string][] = [
  ['What can I pair my coin with?', 'SOL, USDC, or any tokenized stock or ETF the xStocks issuer has on Solana, such as NVDAx or TSLAx. Traders buy your coin with the pair you choose, and fees are earned in it. $FLIP joins the list when it launches.'],
  ['Does a stock pair mean my coin is backed by the stock?', 'No. The stock is only the currency traders use to buy your coin. Tokenized stocks are issued by xStocks, are not brokerage shares, and come with issuer terms and regional restrictions.'],
  ['How is the price set?', 'Each coin trades on its own Meteora bonding curve. Buys move the price up and sells move it down. No presale and no team allocation: everyone buys from the same curve.'],
  ['What happens at graduation?', `Every coin opens near a $${compact(OPEN_MCAP_USD, 0)} market cap. When it reaches about $${compact(GRAD_MCAP_USD, 0)}, the curve is full and anyone can migrate it into a Meteora DAMM v2 pool on Solana. That liquidity is locked forever, and trading continues on the same page and on Jupiter.`],
  ['What do creators earn?', 'Creators pick a 1–3% trading fee. After Meteora’s share, half goes to the creator and half to Flip. Both also earn fees from the locked liquidity after graduation.'],
  ['Is this financial advice?', 'No. Memecoins are extremely volatile and most lose their value. Only use what you can afford to lose.'],
]

export default function Home() {
  const { coins } = useCoins()
  const { assets } = useAssets()
  const prices = useUsdMany(coins.map((c) => c.quoteMint))
  const stocks = assets.filter((a) => a.category === 'stock')
  const latest = coins.slice(0, 5)
  const top = useMemo(() => [...coins].sort((a, b) => b.progress - a.progress).slice(0, 6), [coins])
  const graduated = coins.filter((c) => c.complete || c.migrated).length

  return (
    <>
      <section className="hero wrap">
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>Launch a coin. Pair it with anything.</h1>
            <p>
              Flip launches memecoins on Solana against SOL, USDC or a tokenized stock like NVDAx. Every coin starts on a fair bonding curve and graduates into
              liquidity that stays locked forever.
            </p>
            <div className="cta">
              <Link to="/launch" className="btn btn-primary">
                Launch a coin
              </Link>
              <Link to="/markets" className="btn btn-ghost">
                Browse markets
              </Link>
            </div>
          </div>

          <div className="sky" aria-label="Latest launches">
            <img className="sky-shape" src="/logo-shape.svg" alt="" />
            <div className="sky-head">
              <span>Latest launches</span>
              <span>{coins.length ? `${coins.length} live` : 'Live on Solana'}</span>
            </div>
            {latest.length ? (
              latest.map((c) => (
                <Link key={c.pool} to={`/coin/${c.mint}`} className="sky-row">
                  <CoinImg coin={c} size={40} />
                  <div className="grow">
                    <b>${c.symbol}</b>
                    <div className="sub">
                      {c.name} <PairTag mint={c.quoteMint} />
                    </div>
                  </div>
                  <div className="r">
                    <b>{prices[c.quoteMint] ? usd(c.mcapSvx * prices[c.quoteMint]) : compact(c.mcapSvx)}</b>
                    <span className="muted">{ago(c.createdAt)} ago</span>
                  </div>
                </Link>
              ))
            ) : (
              <div className="sky-empty">
                <h3>The first launch could be yours</h3>
                <p>New coins show up here the moment they go live on Solana.</p>
                <Link to="/launch" className="btn btn-white">
                  Start a launch
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="surface pairs-strip">
          <span className="lbl">Pair with</span>
          <div className="logos">
            {assets.slice(0, 9).map((a) => (
              <AssetIcon key={a.mint} asset={a} size={30} />
            ))}
          </div>
          <span className="muted">SOL, USDC and {stocks.length ? `${stocks.length} tokenized stocks and ETFs` : 'tokenized stocks'}</span>
          <Link to="/stocks" className="link">
            See stock pairs
          </Link>
        </div>
      </section>

      <section className="section wrap">
        <div className="surface facts">
          <div>
            <b>{coins.length}</b>
            <span>Coins launched</span>
          </div>
          <div>
            <b>{graduated}</b>
            <span>Graduated to Solana</span>
          </div>
          <div>
            <b>${compact(OPEN_MCAP_USD, 0)}</b>
            <span>Opening market cap</span>
          </div>
          <div>
            <b>${compact(GRAD_MCAP_USD, 0)}</b>
            <span>Graduation market cap</span>
          </div>
        </div>
      </section>

      <section className="section wrap">
        <div className="section-head">
          <div>
            <h2>Closest to graduating</h2>
            <p>Coins furthest along their bonding curve.</p>
          </div>
          <Link to="/markets" className="btn btn-ghost btn-sm">
            All markets
          </Link>
        </div>
        <div className="surface market-table">
          <MarketHead />
          {top.length ? (
            top.map((c) => <MarketRow key={c.pool} coin={c} price={prices[c.quoteMint]} />)
          ) : (
            <div className="empty">
              <h3>No markets yet</h3>
              <p>Launch the first coin on Flip. It takes one transaction.</p>
              <Link to="/launch" className="btn btn-primary">
                Launch a coin
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="section wrap">
        <div className="section-head">
          <div>
            <h2>How a launch works</h2>
            <p>Three steps from an idea to a coin trading on Solana.</p>
          </div>
        </div>
        <div className="steps">
          <div className="surface step">
            <h3>Create your coin</h3>
            <p>Add an image, a name and a ticker, then pick a pair: SOL, USDC or a tokenized stock. One transaction creates the coin and its market.</p>
          </div>
          <div className="surface step">
            <h3>Trade on the curve</h3>
            <p>Anyone can buy and sell straight away. The price follows Meteora’s bonding curve, and you earn half of every trading fee.</p>
          </div>
          <div className="surface step">
            <h3>Graduate to Solana</h3>
            <p>At about ${compact(GRAD_MCAP_USD, 0)} the curve fills. One click moves it into a locked Meteora pool, and it keeps trading here and on Jupiter.</p>
          </div>
        </div>
      </section>

      <section className="section wrap">
        <div className="section-head">
          <div>
            <h2>Questions</h2>
          </div>
        </div>
        <div className="faq">
          {FAQ.map(([q, a], i) => (
            <details key={q} open={i === 0}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="closing">
        <div className="wrap closing-in">
          <h2>Your coin, on Solana, in one transaction.</h2>
          <Link to="/launch" className="btn btn-white">
            Launch a coin
          </Link>
        </div>
      </section>
    </>
  )
}
