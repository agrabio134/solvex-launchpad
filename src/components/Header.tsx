import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useLaunchpad, useSlot } from '../lib/hooks'
import { X_URL } from '../lib/config'
import { short } from '../lib/format'
import Logo from './Logo'

export default function Header() {
  const slot = useSlot()
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const { svxMint } = useLaunchpad()
  const ca = svxMint ?? ''

  const copy = () => {
    if (!svxMint) return
    navigator.clipboard.writeText(ca)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <header className="hdr">
      <div className="hdr-in">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <Logo />
          <span>SOLVEX</span>
        </Link>

        <nav className={`nav ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
          <NavLink to="/board">Board</NavLink>
          <NavLink to="/launch">Launch</NavLink>
          <NavLink to="/profile">My coins</NavLink>
          <NavLink to="/docs">Docs</NavLink>
        </nav>

        <div className="hdr-right">
          <button className="ca" onClick={copy} title="Copy $SVX contract address">
            <b>$SVX</b>
            <span className="mono">{svxMint ? short(ca, 4) : 'soon'}</span>
            <span className="ca-ico">{copied ? '✓' : '⧉'}</span>
          </button>
          <span className="slot mono" title="Current slot">
            <i className="live-dot" />
            {slot ? slot.toLocaleString() : '———'}
          </span>
          <a className="icon-btn" href={X_URL} target="_blank" rel="noreferrer" aria-label="X">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <path d="M18.9 2H22l-7.6 8.7L23 22h-6.9l-5.4-7-6.2 7H1.4l8.1-9.3L1 2h7l4.9 6.4L18.9 2Zm-1.2 18h1.9L7.1 3.9H5.1L17.7 20Z" />
            </svg>
          </a>
          <WalletMultiButton />
          <button className="burger" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  )
}
