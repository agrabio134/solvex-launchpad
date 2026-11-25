import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCoins } from '../lib/hooks'
import { GRAD_MCAP_USD } from '../lib/config'
import type { Coin } from '../lib/dbc'
import { compact } from '../lib/format'
import CoinCard from '../components/CoinCard'

function useLaunchParams() {
  return {
    threshold: `$${compact(GRAD_MCAP_USD, 0)} market cap`,
    fee: '1–3%',
    creatorShare: '50%',
  }
}

const FAQ: [string, string][] = [
  ['What is $FLIP?', 'The native currency of Solvex. Every coin launched here is priced, bought and sold in $FLIP, so all activity on the platform flows through one token.'],
  ['How do I launch a coin?', 'Connect a Solana wallet holding a little SOL for network fees, open Launch, add an image, a name and a ticker, and optionally make the first buy in $FLIP. The coin appears in New Pairs as soon as the transaction confirms.'],
  ['How is the price set?', 'Each coin trades on its own Meteora Dynamic Bonding Curve. Buying with $FLIP moves the price up the curve, selling moves it down. There are no presales and no team allocations: everyone buys from the same curve.'],
  ['What does graduation mean?', 'When a curve has collected its graduation target in $FLIP, trading on the curve stops. One click (by anyone) migrates the liquidity into a locked Meteora DAMM v2 pool on Solana, where the coin keeps trading here and on every aggregator.'],
  ['Is the graduated liquidity locked?', 'Yes. The LP created at graduation is permanently locked, so it cannot be pulled.'],
  ['Do creators earn anything?', 'Creators earn a share of every trading fee on their coin. Fees build up in the pool and can be claimed anytime from My coins.'],
  ['Which wallets work?', 'Any Solana wallet that supports the Wallet Standard: Phantom, Solflare, Backpack and others.'],
  ['Is this financial advice?', 'No. Memecoins are extremely volatile and most go to zero. Only use what you can afford to lose.'],
]

function Column({ title, tag, coins }: { title: string; tag: string; coins: Coin[] }) {
  return (
    <div className="col">
      <div className="col-head">
        <span className={`tag tag-${tag}`}>{title}</span>
        <span className="mono dim">{coins.length}</span>
      </div>
      <div className="col-list">
        {coins.slice(0, 4).map((c) => (
          <CoinCard key={c.pool} coin={c} />
        ))}
        {coins.length === 0 && <div className="empty">Nothing here yet.</div>}
      </div>
    </div>
  )
}

export default function Home() {
  const { coins } = useCoins(20000)
  const params = useLaunchParams()
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const groups = useMemo(
    () => ({
      fresh: coins.filter((c) => c.status === 'new'),
      final: coins.filter((c) => c.status === 'final').sort((a, b) => b.progress - a.progress),
      grad: coins.filter((c) => c.status === 'graduated'),
      locked: coins.filter((c) => !c.migrated).reduce((s, c) => s + c.reserveSvx, 0),
    }),
    [coins],
  )

  return (
    <div className="home">
      {/* HERO */}
      <section className="hero">
        <div className="hero-grid" aria-hidden />
        <div className="wrap hero-in">
          <div className="eyebrow">
            <i className="live-dot" /> Launchpad live · powered by $FLIP
          </div>
          <h1>
            The memecoin economy,
            <br />
            <em>on one token.</em>
          </h1>
          <p className="lede">
            Solvex is a launchpad built for the memecoin economy and powered entirely by $FLIP. Launch coins, trade them on
            the native curve, and watch the ones that make it graduate straight onto Solana.
          </p>
          <div className="cta-row">
            <Link to="/board" className="btn btn-primary">
              Open the board
            </Link>
            <Link to="/launch" className="btn btn-ghost">
              Launch a coin →
            </Link>
          </div>

          <dl className="stats">
            <div>
              <dt>Currency</dt>
              <dd>$FLIP</dd>
            </div>
            <div>
              <dt>Curve engine</dt>
              <dd>Meteora DBC</dd>
            </div>
            <div>
              <dt>Graduates at</dt>
              <dd>${compact(GRAD_MCAP_USD, 0)}</dd>
            </div>
            <div>
              <dt>Trading fee</dt>
              <dd>{params.fee}</dd>
            </div>
          </dl>

          <div className="flow" aria-label="FLIP flows from launch to Solana">
            {['$FLIP', 'Launch', 'Bonding curve', 'Graduation', 'Solana · DAMM v2'].map((s, i) => (
              <div className="flow-node" key={s}>
                <span className="mono dim">{String(i + 1).padStart(2, '0')}</span>
                <b>{s}</b>
              </div>
            ))}
            <div className="flow-track">
              <i />
            </div>
          </div>
        </div>
      </section>

      {/* 01 LIVE */}
      <section className="sec wrap">
        <SecHead n="01" title="On Solvex right now" sub="Every coin on the launchpad, read straight from the chain." />
        <div className="counters">
          <Counter label="Coins launched" value={coins.length.toLocaleString()} />
          <Counter label="In final stretch" value={groups.final.length.toLocaleString()} />
          <Counter label="Graduated to Solana" value={groups.grad.length.toLocaleString()} />
          <Counter label="FLIP in live curves" value={compact(groups.locked, 1)} />
        </div>
        <div className="cols">
          <Column title="New pairs" tag="new" coins={groups.fresh} />
          <Column title="Final stretch" tag="final" coins={groups.final} />
          <Column title="Graduated" tag="grad" coins={groups.grad} />
        </div>
        <div className="center">
          <Link to="/board" className="btn btn-ghost">
            See the full board →
          </Link>
        </div>
      </section>

      {/* 02 HOW */}
      <section className="sec wrap">
        <SecHead n="02" title="How it works" sub="Three steps from idea to Solana." />
        <div className="steps">
          <Step n="1" title="Hold $FLIP" body="$FLIP is the currency of the whole launchpad. Every buy, sell and first buy is paid in it." />
          <Step n="2" title="Launch or trade" body="Launch a coin with an image, name and ticker, or trade any coin on its bonding curve. Price moves with every trade." />
          <Step n="3" title="Graduate to Solana" body={`At ${params.threshold} the curve completes and liquidity migrates to a locked Meteora DAMM v2 pool on Solana.`} />
        </div>
      </section>

      {/* 03 WHY */}
      <section className="sec wrap">
        <SecHead n="03" title="Why Solvex" sub="A launchpad with its own economy." />
        <div className="cards">
          <Card k="Currency" title="One token underneath" body="All pairs are quoted in $FLIP, so volume on every coin is demand for the same asset." />
          <Card k="Curve" title="Fair launch, every time" body="No presale, no team bag. Everyone buys from the same Meteora bonding curve." />
          <Card k="Fees" title={`Creators earn ${params.creatorShare}`} body={`of the ${params.fee} trading fee on their coin, claimable whenever they like.`} />
          <Card k="Liquidity" title="Locked at graduation" body="The LP created when a coin graduates is permanently locked. It can't be pulled." />
          <Card k="Bridge" title="Born here, listed on Solana" body="Graduated coins land in a DAMM v2 pool and become tradable on Jupiter and every Solana aggregator." />
          <Card k="Keys" title="Your wallet, your coins" body="Non-custodial. You sign every transaction; Solvex never holds your funds." />
        </div>
      </section>

      {/* 04 LOOP */}
      <section className="sec wrap">
        <SecHead n="04" title="The loop" sub="How activity on Solvex feeds back into $FLIP." />
        <ol className="loop">
          <li><b>Coins launch</b> priced in $FLIP</li>
          <li><b>Traders buy</b> with $FLIP on the curve</li>
          <li><b>Fees accrue</b> to creators and the protocol</li>
          <li><b>Winners graduate</b> pairing $FLIP liquidity on Solana</li>
          <li><b>More demand</b> for $FLIP, more launches</li>
        </ol>
      </section>

      {/* 05 FAQ */}
      <section className="sec wrap">
        <SecHead n="05" title="Answers" sub="The short version." />
        <div className="faq">
          {FAQ.map(([q, a], i) => (
            <div key={q} className={`faq-item ${openFaq === i ? 'open' : ''}`}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                <span>{q}</span>
                <span className="mono">{openFaq === i ? '–' : '+'}</span>
              </button>
              {openFaq === i && <p>{a}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="final-cta">
        <div className="wrap">
          <h2>
            One token.
            <br />
            <em>An entire ecosystem.</em>
          </h2>
          <div className="cta-row">
            <Link to="/board" className="btn btn-dark">
              Open the board
            </Link>
            <Link to="/launch" className="btn btn-outline-dark">
              Launch a coin
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

function SecHead({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <div className="sec-head">
      <span className="sec-n mono">{n}</span>
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
    </div>
  )
}
const Counter = ({ label, value }: { label: string; value: string }) => (
  <div className="counter">
    <b className="mono">{value}</b>
    <span>{label}</span>
  </div>
)
const Step = ({ n, title, body }: { n: string; title: string; body: string }) => (
  <div className="step">
    <span className="step-n">{n}</span>
    <h3>{title}</h3>
    <p>{body}</p>
  </div>
)
const Card = ({ k, title, body }: { k: string; title: string; body: string }) => (
  <div className="card">
    <span className="mono dim">{k}</span>
    <h3>{title}</h3>
    <p>{body}</p>
  </div>
)
