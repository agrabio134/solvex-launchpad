import { Link } from 'react-router-dom'
import { TG_URL, X_URL } from '../lib/config'
import Logo from './Logo'

export default function Footer() {
  return (
    <footer className="ftr">
      <div className="ftr-in">
        <div>
          <div className="brand">
            <Logo size={28} />
            Flip
          </div>
          <p>Launch a coin on Solana, pair it with SOL, USDC or a tokenized stock, and graduate it into locked liquidity.</p>
        </div>
        <div className="ftr-cols">
          <div>
            <h5>Trade</h5>
            <Link to="/markets">Markets</Link>
            <Link to="/stocks">Stock pairs</Link>
            <Link to="/portfolio">Portfolio</Link>
          </div>
          <div>
            <h5>Create</h5>
            <Link to="/launch">Launch a coin</Link>
            <Link to="/docs#fees">Fees</Link>
            <Link to="/docs#graduation">Graduation</Link>
          </div>
          <div>
            <h5>Community</h5>
            <a href={X_URL} target="_blank" rel="noreferrer">X</a>
            {TG_URL && <a href={TG_URL} target="_blank" rel="noreferrer">Telegram</a>}
            <Link to="/docs">Docs</Link>
          </div>
        </div>
      </div>
      <div className="ftr-base">
        <span>© {new Date().getFullYear()} Flip. Built on Meteora.</span>
        <span>Memecoins are volatile and can lose all value. Tokenized stock pairs are subject to issuer terms.</span>
      </div>
    </footer>
  )
}
