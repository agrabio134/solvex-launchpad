import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import type { Keypair, Transaction } from '@solana/web3.js'
import { CORE_ASSETS, fetchAssets, fetchCoins, quoteUsd, submit, type Asset, type Coin, type SignTx } from './dbc'
import { FLIP_MINT } from './config'

/* ------------------------------------------------------------ assets */

interface AssetsState {
  assets: Asset[]
  error?: string
  usd: Record<string, number>
  find: (mint: string) => Asset | undefined
  symbol: (mint: string) => string
  setUsd: React.Dispatch<React.SetStateAction<Record<string, number>>>
}
const AssetsCtx = createContext<AssetsState>({ assets: CORE_ASSETS, usd: {}, find: () => undefined, symbol: (m) => m.slice(0, 4), setUsd: () => {} })
export const useAssets = () => useContext(AssetsCtx)

/** Pair catalogue (SOL, USDC, $FLIP, xStocks) and USD prices for any quote asset that is shown. */
export function AssetsProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<Asset[]>(CORE_ASSETS)
  const [error, setError] = useState<string>()
  const [usd, setUsd] = useState<Record<string, number>>({})
  useEffect(() => {
    fetchAssets().then((r) => {
      const flip = FLIP_MINT?.toBase58()
      const list = flip && !r.assets.some((a) => a.mint === flip) ? [{ mint: flip, symbol: 'FLIP', name: 'Flip', category: 'crypto' as const }, ...r.assets] : r.assets
      setAssets(list)
      setError(r.error)
    })
  }, [])
  const value = useMemo<AssetsState>(() => {
    const by = new Map(assets.map((a) => [a.mint, a]))
    return {
      assets,
      error,
      usd,
      find: (m) => by.get(m),
      symbol: (m) => by.get(m)?.symbol ?? `${m.slice(0, 4)}…`,
      setUsd,
    }
  }, [assets, error, usd])
  return createElement(AssetsCtx.Provider, { value }, children)
}

/** USD price for a quote mint (null until known). */
export function useUsd(mint?: string) {
  const ctx = useAssets()
  const set = ctx.setUsd
  useEffect(() => {
    if (!mint || ctx.usd[mint]) return
    quoteUsd(mint).then((v) => v && set((s) => ({ ...s, [mint]: v })))
  }, [mint])
  return mint ? (ctx.usd[mint] ?? null) : null
}

/** Prices for many quote mints at once (markets list). */
export function useUsdMany(mints: string[]) {
  const ctx = useAssets()
  const set = ctx.setUsd
  const key = [...new Set(mints)].sort().join(',')
  useEffect(() => {
    key.split(',').filter(Boolean).forEach((m) => {
      if (!ctx.usd[m]) quoteUsd(m).then((v) => v && set((s) => ({ ...s, [m]: v })))
    })
  }, [key])
  return ctx.usd
}

/* ------------------------------------------------------------ chain */

/** All Solvex markets, refreshed every `ms`. */
export function useCoins(ms = 20000) {
  const { connection } = useConnection()
  const [coins, setCoins] = useState<Coin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      setCoins(await fetchCoins(connection))
      setError(null)
    } catch (e: any) {
      setError(errMsg(e))
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

export function useSlot() {
  const { connection } = useConnection()
  const [slot, setSlot] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const tick = () => connection.getSlot().then((s) => alive && setSlot(s)).catch(() => {})
    tick()
    const t = setInterval(tick, 4000)
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
  if (/User rejected|rejected the request/i.test(m)) return 'Cancelled in wallet'
  if (/insufficient/i.test(m)) return 'Insufficient balance'
  if (/slippage|0x1774|ExceededSlippage/i.test(m)) return 'Price moved past your slippage'
  if (/429|Too many/i.test(m)) return 'Network is busy, retry in a moment'
  return m.length > 160 ? m.slice(0, 160) + '…' : m
}
