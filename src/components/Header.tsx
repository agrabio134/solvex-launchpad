import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useSlot } from '../lib/hooks'
import { FLIP_MINT, X_URL } from '../lib/config'
import { short } from '../lib/format'
import Logo from './Logo'

export default function Header() {
  const slot = useSlot()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const flip = FLIP_MINT?.toBase58()

  return (
    <header className="hdr">
      <div className="hdr-in">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <Logo size={30} />
          Solvex
        </Link>
        <nav className={`nav ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
          <NavLink to="/markets">Markets</NavLink>
          <NavLink to="/launch">Launch</NavLink>
          <NavLink to="/stocks">Stock pairs</NavLink>
          <NavLink to="/portfolio">Portfolio</NavLink>
          <NavLink to="/docs">Docs</NavLink>
        </nav>
        <div className="hdr-right">
          <button
            className="pill"
            title={flip ? 'Copy the $FLIP contract address' : '$FLIP launches soon'}
            onClick={() => {
              if (!flip) return
              navigator.clipboard.writeText(flip)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            <b>$FLIP</b> {flip ? (copied ? 'Copied' : short(flip)) : 'soon'}
          </button>
          <span className="pill slot" title="Latest Solana slot">
            <i className="dot" />
            {slot ? slot.toLocaleString() : 'Connecting'}
          </span>
          <a className="icon-btn" href={X_URL} target="_blank" rel="noreferrer" aria-label="Solvex on X">
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
