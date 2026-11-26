import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useSolPrice } from '../lib/hooks'
import { X_URL } from '../lib/config'
import Logo from './Logo'

export default function Header() {
  const sol = useSolPrice()
  const [open, setOpen] = useState(false)

  return (
    <header className="hdr">
      <div className="hdr-in">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <Logo size={30} />
          Flip
        </Link>
        <nav className={`nav ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
          <NavLink to="/markets">Markets</NavLink>
          <NavLink to="/launch">Launch</NavLink>
          <NavLink to="/stocks">Stock pairs</NavLink>
          <NavLink to="/portfolio">Portfolio</NavLink>
          <NavLink to="/docs">Docs</NavLink>
          <NavLink to="/flip">
            $FLIP<i className="soon-tag">Soon</i>
          </NavLink>

        </nav>
        <div className="hdr-right">
          <Link to="/flip" className="pill flip-ca" title="The $FLIP contract address is announced soon">
            <b>$FLIP</b> CA: SOON
          </Link>
          <span className="pill slot" title="Live SOL price in USD">
            <i className="dot" />
            SOL {sol ? `$${sol.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '…'}
          </span>
          <a className="icon-btn" href={X_URL} target="_blank" rel="noreferrer" aria-label="Flip on X">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
              <path d="M18.9 2H22l-7.6 8.7L23 22h-6.9l-5.4-7-6.2 7H1.4l8.1-9.3L1 2h7l4.9 6.4L18.9 2Zm-1.2 18h1.9L7.1 3.9H5.1L17.7 20Z" />
            </svg>
          </a>
          <WalletMultiButton />
          <button className="burger" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  )
}
