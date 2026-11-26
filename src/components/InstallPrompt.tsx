import { useEffect, useState } from 'react'

/**
 * "Add Flip to your phone" banner.
 * Android (Chrome, Edge, Samsung Internet): uses the browser's own install prompt.
 * iPhone/iPad Safari has no install prompt, so it explains the two taps instead.
 * Hidden inside the installed app, on desktop, and for 7 days after "Not now".
 */
const KEY = 'flip-install-dismissed'
const WAIT_DAYS = 7

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
const mobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
const ios = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
const snoozed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) || 0) < WAIT_DAYS * 86_400_000
  } catch {
    return false
  }
}

export default function InstallPrompt() {
  const [event, setEvent] = useState<BIPEvent | null>(null)
  const [show, setShow] = useState<'android' | 'ios' | null>(null)

  useEffect(() => {
    if (standalone() || !mobile() || snoozed()) return
    const onPrompt = (e: Event) => {
      e.preventDefault() // show our banner instead of the browser's mini-infobar
      setEvent(e as BIPEvent)
      setTimeout(() => setShow('android'), 2500)
    }
    const onInstalled = () => setShow(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    // Safari on iOS never fires beforeinstallprompt
    const t = ios() ? setTimeout(() => setShow('ios'), 3000) : undefined
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      if (t) clearTimeout(t)
    }
  }, [])

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()))
    } catch {
      /* storage unavailable */
    }
    setShow(null)
  }

  const install = async () => {
    if (!event) return
    await event.prompt()
    const { outcome } = await event.userChoice
    setEvent(null)
    if (outcome === 'accepted') setShow(null)
    else dismiss()
  }

  if (!show) return null
  return (
    <div className="install" role="dialog" aria-label="Install Flip">
      <img src="/icon-192.png" alt="" width={48} height={48} />
      <div className="install-text">
        <b>Get the Flip app</b>
        {show === 'android' ? (
          <span>Add Flip to your home screen. It opens full screen, like a regular app.</span>
        ) : (
          <span>
            Tap <ShareIcon /> Share, then <b>Add to Home Screen</b>.
          </span>
        )}
      </div>
      <div className="install-actions">
        {show === 'android' && (
          <button className="btn btn-primary btn-sm" onClick={install}>
            Install
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={dismiss}>
          {show === 'android' ? 'Not now' : 'Got it'}
        </button>
      </div>
    </div>
  )
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share icon" style={{ verticalAlign: '-2px' }}>
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}
