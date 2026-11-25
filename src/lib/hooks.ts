import { useCallback, useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import type { Transaction } from '@solana/web3.js'
import { fetchCoins, type Coin } from './dbc'
import { DEMO } from './config'

/** All coins on the Solvex config, refreshed every `ms`. */
export function useCoins(ms = 15000) {
  const { connection } = useConnection()
  const [coins, setCoins] = useState<Coin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
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
    const t = setInterval(tick, DEMO ? 4000 : 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [connection])
  return slot
}

/** Signs + sends a prepared transaction with the connected wallet and waits for confirmation. */
export function useSend() {
  const { connection } = useConnection()
  const { sendTransaction } = useWallet()
  return useCallback(
    async (tx: Transaction) => {
      const sig = await sendTransaction(tx, connection, { skipPreflight: false, maxRetries: 3 })
      const res = await connection.confirmTransaction(
        { signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight! },
        'confirmed',
      )
      if (res.value.err) throw new Error('Transaction failed on-chain')
      return sig
    },
    [connection, sendTransaction],
  )
}

export function errMsg(e: any): string {
  const m = e?.message || String(e)
  if (/User rejected/i.test(m)) return 'Cancelled in wallet'
  if (/insufficient|0x1\b/i.test(m)) return 'Insufficient balance'
  if (/slippage|0x1774|ExceededSlippage/i.test(m)) return 'Price moved past your slippage'
  return m.length > 140 ? m.slice(0, 140) + '…' : m
}
