import { Link } from 'react-router-dom'
import { TG_URL, X_URL } from '../lib/config'
import { useLaunchpad } from '../lib/hooks'
import Logo from './Logo'

export default function Footer() {
  const { svxMint } = useLaunchpad()
  return (
    <footer className="ftr">
      <div className="ftr-in">
        <div className="ftr-brand">
          <div className="brand">
            <Logo />
            <span>SOLVEX</span>
          </div>
          <p>One token. An entire ecosystem.</p>
        </div>
        <div className="ftr-cols">
          <div>
            <h5>App</h5>
            <Link to="/board">Board</Link>
            <Link to="/launch">Launch a coin</Link>
            <Link to="/profile">My coins</Link>
          </div>
          <div>
            <h5>Ecosystem</h5>
            <Link to="/docs">Docs</Link>
            <Link to="/docs#graduation">Graduation</Link>
            <Link to="/docs#fees">Fees</Link>
          </div>
          <div>
            <h5>$SVX</h5>
            {svxMint && (
              <a href={`https://jup.ag/swap/SOL-${svxMint}`} target="_blank" rel="noreferrer">
                Buy $SVX
              </a>
            )}
            <a href={X_URL} target="_blank" rel="noreferrer">
              X / Twitter
            </a>
            {TG_URL && (
              <a href={TG_URL} target="_blank" rel="noreferrer">
                Telegram
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="ftr-base">
        <span>© {new Date().getFullYear()} Solvex</span>
        <span>Memecoins are volatile. Nothing here is financial advice.</span>
      </div>
    </footer>
  )
}
