import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CONFIGURED } from '../lib/config'
import { useLaunchpad } from '../lib/hooks'

/** Renders children only once the launchpad config exists and loads from the chain. */
export default function Gate({ children }: { children: ReactNode }) {
  const { lp, error } = useLaunchpad()
  if (!CONFIGURED)
    return (
      <div className="wrap page">
        <div className="panel center-panel">
          <span className="tag tag-final">Opening soon</span>
          <h2>The launchpad is being set up</h2>
          <p className="dim">Coins can be launched and traded as soon as the Solvex curve is live on-chain.</p>
          <Link to="/" className="btn btn-ghost">
            Back home
          </Link>
        </div>
      </div>
    )
  if (!lp)
    return (
      <div className="wrap page">
        {error ? (
          <div className="notice notice-err">Can't reach the launchpad right now: {error}. Retrying…</div>
        ) : (
          <div className="coin skeleton tall" />
        )}
      </div>
    )
  return <>{children}</>
}
