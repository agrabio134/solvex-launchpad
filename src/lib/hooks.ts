import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import type { AddressLookupTableAccount, Keypair, Transaction } from '@solana/web3.js'
import { CORE_ASSETS, fetchAssets, fetchCoins, quoteUsd, submit, type Asset, type Coin, type SignTx, type Budget } from './chain'
import { WSOL_MINT } from './config'
import { friendly } from './errors'

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

/** Pair catalogue (SOL, USDC, xStocks) and USD prices for any quote asset that is shown. */
export function AssetsProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<Asset[]>(CORE_ASSETS)
  const [error, setError] = useState<string>()
  const [usd, setUsd] = useState<Record<string, number>>({})
  useEffect(() => {
    fetchAssets().then((r) => {
      setAssets(r.assets)
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

/** All Flip markets, refreshed every `ms`. */
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
    async (tx: Transaction, signers: Keypair[] = [], onStatus: (s: string) => void = () => {}, budget?: Budget, luts: AddressLookupTableAccount[] = []) => {
      if (!publicKey || !signTransaction) throw new Error('Connect a wallet that can sign transactions')
      return submit(connection, publicKey, signTransaction as SignTx, tx, signers, onStatus, budget, luts)
    },
    [connection, publicKey, signTransaction],
  )
}

/** Plain-language message for any error (wallet, network, simulation, on-chain). */
export function errMsg(e: any): string {
  return friendly(e)
}

/** Live SOL/USD price for the header, refreshed every 30 seconds (also shared with the price context). */
export function useSolPrice() {
  const ctx = useAssets()
  const set = ctx.setUsd
  const sol = WSOL_MINT.toBase58()
  useEffect(() => {
    let alive = true
    const tick = () => quoteUsd(sol).then((v) => alive && v && set((s) => ({ ...s, [sol]: v })))
    tick()
    const t = setInterval(tick, 30000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  return ctx.usd[sol] ?? null
}
