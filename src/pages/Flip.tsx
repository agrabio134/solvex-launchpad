import { Link } from 'react-router-dom'
import { X_URL } from '../lib/config'

/** $FLIP teaser: nothing is live yet, so this page only says what's coming and where it will be announced. */
export default function Flip() {
  return (
    <div className="wrap page">
      <div className="flip-page">
        <div className="flip-coin" aria-hidden>
          <img src="/icon-192.png" alt="" />
        </div>
        <h1>
          $FLIP <span className="soon-big">Soon</span>
        </h1>
        <p className="lead">The Flip token is on its way. Its contract address will be posted here and on our X account first.</p>

        <div className="ca-box">
          <div>
            <span>Contract address</span>
            <b>Announced soon</b>
          </div>
          <button className="btn btn-ghost btn-sm" disabled>
            Copy
          </button>
        </div>

        <div className="flip-actions">
          <a className="btn btn-primary" href={X_URL} target="_blank" rel="noreferrer">
            Follow Flip on X for the launch
          </a>
          <Link to="/launch" className="btn btn-ghost">
            Launch a coin meanwhile
          </Link>
        </div>

        <p className="flip-note">Until the address appears on this page, any token calling itself $FLIP isn't ours. Never buy one from a link someone sends you.</p>
      </div>
    </div>
  )
}
