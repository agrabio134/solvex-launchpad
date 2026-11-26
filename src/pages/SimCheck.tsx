/** TEMPORARY (sim-check branch only): simulate SOL-routed trades on mainnet. Sends nothing. */
import { useEffect, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { compileForWallet, fetchCoins, prepareSwap } from '../lib/dbc'

export default function SimCheck() {
  const { connection } = useConnection()
  const [log, setLog] = useState<any[]>([])
  useEffect(() => {
    const out: any[] = []
    const push = (x: any) => {
      out.push(x)
      setLog([...out])
    }
    ;(async () => {
      try {
        const payer = new PublicKey('9TNAMr6xphQfcXrJ9ktjbXzY9BBFijzvrQbUoctqiYj1') // funded address, simulation only
        push({ payerSol: (await connection.getBalance(payer)) / 1e9 })
        const coins = await fetchCoins(connection)
        push({ coins: coins.map((c) => ({ s: c.symbol, quote: c.quoteMint.slice(0, 6), mint: c.mint })) })
        for (const c of coins.slice(0, 3)) {
          for (const amt of ['0.05', '0.5']) {
            try {
              await new Promise((r) => setTimeout(r, 1500))
              const p = await prepareSwap(connection, c, 'buy', amt, 200, payer, 'sol')
              const { blockhash } = await connection.getLatestBlockhash('confirmed')
              const routed = c.quoteMint !== 'So11111111111111111111111111111111111111112'
              const v = compileForWallet(p.tx, payer, blockhash, [], routed ? 'route' : 'swap', p.luts)
              const size = v.serialize().length
              const r = await connection.simulateTransaction(v, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' })
              push({ label: `BUY ${amt} SOL of $${c.symbol}${routed ? ' (routed via Jupiter)' : ''}`, size, fits: size <= 1232, luts: p.luts.length, out: p.out, minOut: p.minOut, impact: p.priceImpact, ok: !r.value.err, err: r.value.err, units: r.value.unitsConsumed, logs: r.value.err ? (r.value.logs ?? []).slice(-6) : (r.value.logs ?? []).filter((l) => /Instruction: (Swap|Route|SharedAccountsRoute)/.test(l)).slice(0, 6) })
            } catch (e: any) {
              push({ label: `BUY ${amt} SOL of $${c.symbol}`, error: e?.message })
            }
          }
        }
        push({ done: true })
      } catch (e: any) {
        push({ error: e?.message })
      }
    })()
  }, [connection])
  return <pre id="sim" style={{ padding: 24, fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(log, null, 2)}</pre>
}
