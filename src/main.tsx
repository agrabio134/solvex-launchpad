import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import '@solana/wallet-adapter-react-ui/styles.css'
import './styles.css'
import App from './App'
import { RPC_URL } from './lib/config'
import { ToastProvider } from './components/Toast'
import { AssetsProvider } from './lib/hooks'

function Root() {
  // Phantom, Solflare, Backpack etc. are picked up automatically through the Wallet Standard.
  const wallets = useMemo(() => [], [])
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AssetsProvider>
            <ToastProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </ToastProvider>
          </AssetsProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

// installable app + instant reopen (service worker only in production builds)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
