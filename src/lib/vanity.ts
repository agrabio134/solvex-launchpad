/**
 * Every Flip coin's mint address ends in "FLP". The address is found on the launcher's own device
 * (several Web Workers race), so its secret key never leaves the browser and nothing is stored on a server.
 * One address is found in the background as soon as the launch page opens; each launch uses it once.
 */
import { Keypair } from '@solana/web3.js'

export const MINT_SUFFIX = 'FLP'

let pending: Promise<Keypair> | null = null

function search(): Promise<Keypair> {
  const n = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
  return new Promise((resolve, reject) => {
    const workers: Worker[] = []
    const stop = () => workers.forEach((w) => w.terminate())
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./vanity.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<{ seed: number[] }>) => {
        stop()
        const kp = Keypair.fromSeed(Uint8Array.from(e.data.seed))
        if (!kp.publicKey.toBase58().endsWith(MINT_SUFFIX)) return reject(new Error('Address search failed. Try again.'))
        resolve(kp)
      }
      w.onerror = (err) => {
        stop()
        reject(new Error(err.message || 'Address search failed. Try again.'))
      }
      w.postMessage({ suffix: MINT_SUFFIX })
      workers.push(w)
    }
  })
}

/** Start looking for the next FLP address (no-op if one is already found or being found). */
export function prefetchMint() {
  if (!pending) {
    pending = search()
    pending.catch(() => (pending = null))
  }
  return pending
}

/** Hands out the found address once; the next call starts a new search. */
export async function takeMint(): Promise<Keypair> {
  const kp = await prefetchMint()
  pending = null
  return kp
}
