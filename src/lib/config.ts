import { PublicKey } from '@solana/web3.js'

const env = import.meta.env

const pk = (v?: string) => {
  try {
    return v ? new PublicKey(v) : null
  } catch {
    return null
  }
}

export const RPC_URL: string = env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com'
export const CLUSTER: string = env.VITE_CLUSTER || 'mainnet-beta'
export const SVX_MINT = pk(env.VITE_SVX_MINT)
export const SVX_DECIMALS = Number(env.VITE_SVX_DECIMALS || 6)
export const DBC_CONFIG = pk(env.VITE_DBC_CONFIG)
export const X_URL: string = env.VITE_X_URL || 'https://x.com'
export const TG_URL: string = env.VITE_TG_URL || ''

/** Without a config key the app runs on clearly-labelled sample coins so the UI can be previewed. */
export const DEMO = !DBC_CONFIG || !SVX_MINT

/** Progress share at which a coin moves from New Pairs to Final Stretch. */
export const FINAL_STRETCH_AT = 0.6

export const explorerTx = (sig: string) =>
  `https://solscan.io/tx/${sig}${CLUSTER === 'devnet' ? '?cluster=devnet' : ''}`
export const explorerAddr = (a: string) =>
  `https://solscan.io/account/${a}${CLUSTER === 'devnet' ? '?cluster=devnet' : ''}`
export const jupiterSwap = (mint: string) =>
  `https://jup.ag/swap/${SVX_MINT?.toBase58() ?? 'SOL'}-${mint}`
