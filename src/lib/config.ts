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

/** $FLIP mint, once $FLIP is live. It then appears as a pair option. */
export const FLIP_MINT = pk(env.VITE_FLIP_MINT || env.VITE_SVX_MINT)
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')
export const FLIP_LIVE = !!FLIP_MINT

/** Platform wallet: fee claimer + leftover receiver on every launch config. Markets are discovered by it. */
export const PLATFORM_WALLET = pk(env.VITE_PLATFORM_WALLET) ?? new PublicKey('C1rdVXhfUe3RDNxMFrGYSHN6MpkhjTLhVaBk3ZpMJWnT')

/** Launch market caps in USD, converted to $FLIP at the live price at launch time. */
export const OPEN_MCAP_USD = Number(env.VITE_OPEN_MCAP_USD || 4_000)
export const GRAD_MCAP_USD = Number(env.VITE_GRAD_MCAP_USD || 35_000)
/** Optional fixed caps in $FLIP, used only when no live $FLIP price is available. */
export const OPEN_MCAP_FLIP = Number(env.VITE_OPEN_MCAP_FLIP || 0)
export const GRAD_MCAP_FLIP = Number(env.VITE_GRAD_MCAP_FLIP || 0)

export const X_URL: string = env.VITE_X_URL || 'https://x.com'
export const TG_URL: string = env.VITE_TG_URL || ''

/**
 * Only markets launched after this moment (unix seconds) are shown. Hides older pools that share
 * the platform wallet (e.g. from the previous FirePad launchpad). Default: Solvex go-live, 2026-11-25.
 */
export const LISTED_AFTER = Number(env.VITE_LISTED_AFTER || 1795616000)


/** Progress share at which a coin moves from New Pairs to Final Stretch. */
export const FINAL_STRETCH_AT = 0.6

export const explorerTx = (sig: string) => `https://solscan.io/tx/${sig}`
export const explorerAddr = (a: string) => `https://solscan.io/account/${a}`
export const jupiterSwap = (inMint: string, outMint: string) => `https://jup.ag/swap/${inMint}-${outMint}`
