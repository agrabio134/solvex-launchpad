import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import type { Keypair, Transaction } from '@solana/web3.js'
import { fetchCoins, fetchFlipUsd, getLaunchpad, submit, type Coin, type Launchpad, type SignTx } from './dbc'
import { CONFIGURED, FLIP_MINT } from './config'

/** All coins on the Solvex config, refreshed every `ms`. */
export function useCoins(ms = 15000) {
  const { connection } = useConnection()
  const [coins, setCoins] = useState<Coin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!CONFIGURED) return setLoading(false)
    try {
      setCoins(await fetchCoins(connection))
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load coins')
    } finally {
      setLoading(false)
    }
  }, [connection])

  useEffect(() => {
    load()
    const t = setInterval(load, ms)
    return () => clearInterval(t)
  }, [load, ms])

  return { coins, loading, error, reload: load }
}

/** Live slot counter for the header. */
export function useSlot() {
  const { connection } = useConnection()
  const [slot, setSlot] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const tick = () =>
      connection
        .getSlot()
        .then((s) => alive && setSlot(s))
        .catch(() => {})
    tick()
    const t = setInterval(tick, 2500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [connection])
  return slot
}

/** Simulates, has the wallet sign, sends and confirms. Returns the signature. */
export function useSubmit() {
  const { connection } = useConnection()
  const { publicKey, signTransaction } = useWallet()
  return useCallback(
    async (tx: Transaction, signers: Keypair[] = [], onStatus: (s: string) => void = () => {}) => {
      if (!publicKey || !signTransaction) throw new Error('Connect a wallet that can sign transactions')
      return submit(connection, publicKey, signTransaction as SignTx, tx, signers, onStatus)
    },
    [connection, publicKey, signTransaction],
  )
}

export function errMsg(e: any): string {
  const m = e?.message || String(e)
  if (/User rejected/i.test(m)) return 'Cancelled in wallet'
  if (/insufficient|0x1\b/i.test(m)) return 'Insufficient balance'
  if (/slippage|0x1774|ExceededSlippage/i.test(m)) return 'Price moved past your slippage'
  if (/rate|429/i.test(m)) return 'Network is busy, retry in a moment'
  return m.length > 140 ? m.slice(0, 140) + '…' : m
}

/* ------------------------------------------------------------ launchpad */

interface LpState {
  lp: Launchpad | null
  error: string | null
  svxMint: string | null
  usd: number | null
}
const LpCtx = createContext<LpState>({ lp: null, error: null, svxMint: FLIP_MINT?.toBase58() ?? null, usd: null })
export const useLaunchpad = () => useContext(LpCtx)

/** Loads the Solvex DBC config once and shares it ($FLIP mint, decimals, fees, graduation threshold). */
export function LaunchpadProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection()
  const [state, setState] = useState<LpState>({ lp: null, error: null, svxMint: FLIP_MINT?.toBase58() ?? null, usd: null })
  useEffect(() => {
    if (!CONFIGURED) return
    let alive = true
    const go = () =>
      getLaunchpad(connection)
        .then((lp) => alive && setState((s) => ({ ...s, lp, error: null, svxMint: lp.quoteMint.toBase58() })))
        .catch((e) => {
          if (!alive) return
          setState((s) => ({ ...s, error: e?.message || 'Could not load launchpad config' }))
          setTimeout(go, 8000)
        })
    go()
    const price = () => fetchFlipUsd().then((usd) => alive && setState((s) => ({ ...s, usd })))
    price()
    const t = setInterval(price, 60000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [connection])
  return createElement(LpCtx.Provider, { value: state }, children)
}
