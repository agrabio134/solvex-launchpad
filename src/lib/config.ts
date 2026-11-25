import { PublicKey } from '@solana/web3.js'

const env = import.meta.env

const pk = (v?: string) => {
  try {
    return v ? new PublicKey(v.trim()) : null
  } catch {
    return null
  }
}

export const RPC_URL: string = env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com'
export const CLUSTER: string = env.VITE_CLUSTER || 'mainnet-beta'
/** The Solvex Meteora DBC config. Its quote mint is $SVX, so SVX is read from it. */
export const DBC_CONFIG = pk(env.VITE_DBC_CONFIG)
/** Optional: shown in the header before the config exists. */
export const SVX_MINT_ENV = pk(env.VITE_SVX_MINT)
/** Wallet allowed to see the /admin setup page controls (optional, purely cosmetic gate). */
export const ADMIN_WALLET: string = env.VITE_ADMIN_WALLET || ''
export const X_URL: string = env.VITE_X_URL || 'https://x.com'
export const TG_URL: string = env.VITE_TG_URL || ''

export const CONFIGURED = !!DBC_CONFIG

/** Progress share at which a coin moves from New Pairs to Final Stretch. */
export const FINAL_STRETCH_AT = 0.6

const q = CLUSTER === 'devnet' ? '?cluster=devnet' : ''
export const explorerTx = (sig: string) => `https://solscan.io/tx/${sig}${q}`
export const explorerAddr = (a: string) => `https://solscan.io/account/${a}${q}`
export const jupiterSwap = (inMint: string, outMint: string) => `https://jup.ag/swap/${inMint}-${outMint}`
