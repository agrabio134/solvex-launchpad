import { PublicKey } from '@solana/web3.js'

const env = import.meta.env

const pk = (v?: string) => {
  try {
    return v ? new PublicKey(v.trim()) : null
  } catch {
    return null
  }
}

/** Browser talks to the same-origin proxy (api/rpc.ts); the real RPC URL stays server-side. */
export const RPC_URL: string = env.VITE_RPC_URL || `${window.location.origin}/api/rpc`
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'

export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')

/** Admin wallet: the only wallet that can open /#ops (hide or restore markets on Flip's list). */
export const PLATFORM_WALLET = pk(env.VITE_PLATFORM_WALLET) ?? new PublicKey('C1rdVXhfUe3RDNxMFrGYSHN6MpkhjTLhVaBk3ZpMJWnT')

export const X_URL: string = env.VITE_X_URL || 'https://x.com/Flipchain_'
export const TG_URL: string = env.VITE_TG_URL || ''

/** Progress share at which a coin moves from New Pairs to Final Stretch. */
export const FINAL_STRETCH_AT = 0.6

export const explorerTx = (sig: string) => `https://solscan.io/tx/${sig}`
export const explorerAddr = (a: string) => `https://solscan.io/account/${a}`
export const jupiterSwap = (inMint: string, outMint: string) => `https://jup.ag/swap/${inMint}-${outMint}`
