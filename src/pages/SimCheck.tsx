/** TEMPORARY (sim-check branch only): simulate launch / buy / sell / migrate on mainnet. Sends nothing. */
import { useEffect, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction, type Keypair } from '@solana/web3.js'
import { buildLaunch, compileForWallet, fetchAssets } from '../lib/dbc'
import { PLATFORM_WALLET } from '../lib/config'

export default function SimCheck() {
  const { connection } = useConnection()
  const [log, setLog] = useState<any[]>([])
  useEffect(() => {
    const out: any[] = []
    const push = (x: any) => {
      out.push(x)
      setLog([...out])
    }
    const sim = async (label: string, tx: Transaction, payer: PublicKey, signers: Keypair[] = [], budget: 'swap' | 'launch' | 'migrate' = signers.length ? 'launch' : 'swap') => {
      await new Promise((r) => setTimeout(r, 1500))
      const { blockhash } = await connection.getLatestBlockhash('confirmed')
      const v = compileForWallet(tx, payer, blockhash, signers, budget)
      const size = v.serialize().length
      const r = await connection.simulateTransaction(v, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' })
      push({ label, size, fits: size <= 1232, ok: !r.value.err, err: r.value.err, units: r.value.unitsConsumed, logs: r.value.err ? (r.value.logs ?? []).slice(-6) : undefined })
    }
    ;(async () => {
      try {
        push({ platformSol: (await connection.getBalance(PLATFORM_WALLET)) / 1e9 })
        // simulation-only payer: a recently active DBC trader with SOL (nothing is signed or sent)
        const payer = new PublicKey('9TNAMr6xphQfcXrJ9ktjbXzY9BBFijzvrQbUoctqiYj1') // funded address, simulation only
        push({ simPayer: payer.toBase58(), sol: (await connection.getBalance(payer)) / 1e9 })
        const { assets } = await fetchAssets()
        const stocks = assets.filter((x) => x.category === 'stock' && !x.halted)
        push({ assets: assets.length, stocks: stocks.length, sample: stocks.slice(0, 3).map((x) => x.symbol) })
        const pairs = [assets.find((x) => x.symbol === 'SOL')!, ...stocks.slice(0, 3)]
        for (const a of pairs) {
          try {
            const l = await buildLaunch(connection, payer, { quoteMint: a.mint, name: 'Maximum Length Coin Name Here!!', symbol: 'MAXTICKER1', uri: 'https://2n294j50bru6m0pn.public.blob.vercel-storage.com/m/49BmchtwCyRYj.json', feeBps: 100, dynamic: true, shield: true })
            push({ pair: a.symbol, caps: { open: +l.caps.initialCap.toFixed(4), grad: +l.caps.graduationCap.toFixed(4), usd: l.caps.usd } })
            await sim(`LAUNCH paired with ${a.symbol} (max-length name/ticker)`, l.tx, payer, l.signers)
          } catch (e: any) {
            push({ pair: a.symbol, buildError: e?.message })
          }
        }
        push({ done: true })
      } catch (e: any) {
        push({ error: e?.message, stack: String(e?.stack).slice(0, 400) })
      }
    })()
  }, [connection])
  return <pre id="sim" style={{ padding: 24, fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(log, null, 2)}</pre>
}
