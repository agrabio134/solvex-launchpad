/** TEMPORARY (sim-check branch only): simulate launch / buy / sell / migrate on mainnet. Sends nothing. */
import { useEffect, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { ComputeBudgetProgram, PublicKey, Transaction, VersionedTransaction, type Keypair } from '@solana/web3.js'
import { buildLaunch, buildMigrate, fetchAssets, fetchCoins, prepareSwap, tokenBalance } from '../lib/dbc'
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
    const sim = async (label: string, tx: Transaction, payer: PublicKey, signers: Keypair[] = []) => {
      const fresh = new Transaction().add(...tx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId)))
      const { blockhash } = await connection.getLatestBlockhash('confirmed')
      fresh.feePayer = payer
      fresh.recentBlockhash = blockhash
      fresh.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
      if (!signers.length) fresh.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }))
      const v = new VersionedTransaction(fresh.compileMessage())
      if (signers.length) v.sign(signers)
      const size = v.serialize().length
      const r = await connection.simulateTransaction(v, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' })
      push({ label, size, ok: !r.value.err, err: r.value.err, units: r.value.unitsConsumed, logs: r.value.err ? (r.value.logs ?? []).slice(-8) : (r.value.logs ?? []).filter((l) => /Instruction:/.test(l)).slice(0, 8) })
    }
    ;(async () => {
      try {
        push({ platformSol: (await connection.getBalance(PLATFORM_WALLET)) / 1e9 })
        // simulation-only payer: a recently active DBC trader with SOL (nothing is signed or sent)
        const DBC = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN')
        let payer = PLATFORM_WALLET
        for (const s of await connection.getSignaturesForAddress(DBC, { limit: 15 })) {
          const t = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null)
          const k = t?.transaction.message.staticAccountKeys[0]
          if (k && (await connection.getBalance(k)) > 2e9) {
            payer = k
            break
          }
        }
        push({ simPayer: payer.toBase58(), sol: (await connection.getBalance(payer)) / 1e9 })
        const { assets } = await fetchAssets()
        const stocks = assets.filter((x) => x.category === 'stock' && !x.halted)
        push({ assets: assets.length, stocks: stocks.length, sample: stocks.slice(0, 3).map((x) => x.symbol) })
        const pairs = [assets.find((x) => x.symbol === 'SOL')!, assets.find((x) => x.symbol === 'USDC')!, ...stocks.slice(0, 3)]
        for (const a of pairs) {
          try {
            const l = await buildLaunch(connection, payer, { quoteMint: a.mint, name: 'Maximum Length Coin Name Here!!', symbol: 'MAXTICKER1', uri: 'https://2n294j50bru6m0pn.public.blob.vercel-storage.com/m/49BmchtwCyRYj.json', feeBps: 100, dynamic: true, shield: true })
            push({ pair: a.symbol, caps: { open: +l.caps.initialCap.toFixed(4), grad: +l.caps.graduationCap.toFixed(4), usd: l.caps.usd } })
            await sim(`LAUNCH paired with ${a.symbol} (max-length name/ticker)`, l.tx, payer, l.signers)
          } catch (e: any) {
            push({ pair: a.symbol, buildError: e?.message })
          }
        }
        const coins = await fetchCoins(connection)
        push({ coins: coins.map((c) => ({ s: c.symbol, prog: +c.progress.toFixed(3), complete: c.complete, migrated: c.migrated, creator: c.creator.slice(0, 6) })) })
        const live = coins.find((c) => !c.complete)
        if (live) {
          const b = await prepareSwap(connection, live, 'buy', '0.01', 200, payer)
          push({ buyQuote: { coin: live.symbol, out: b.out, minOut: b.minOut } })
          await sim(`BUY 0.01 SOL of ${live.symbol} (curve)`, b.tx, payer)
          // sell: use the creator, who usually holds tokens
          const creator = new PublicKey(live.creator)
          const held = await tokenBalance(connection, creator, new PublicKey(live.mint))
          if (held > 1) {
            const s = await prepareSwap(connection, live, 'sell', String(Math.floor(held / 10)), 200, creator)
            push({ sellQuote: { coin: live.symbol, tokensIn: Math.floor(held / 10), solOut: s.out } })
            await sim(`SELL ${live.symbol} (curve)`, s.tx, creator)
          } else push({ sell: 'creator holds no tokens to test a sell with' })
        }
        const ready = coins.find((c) => c.complete && !c.migrated)
        if (ready) {
          const m = await buildMigrate(connection, ready, payer)
          await sim(`MIGRATE ${ready.symbol}`, m.tx, payer, m.signers)
        } else push({ migrate: 'no completed-but-unmigrated pool to test' })
        const grad = coins.find((c) => c.migrated)
        if (grad) {
          const g = await prepareSwap(connection, grad, 'buy', '0.01', 200, payer)
          await sim(`BUY 0.01 SOL of ${grad.symbol} (DAMM v2, graduated)`, g.tx, payer)
        } else push({ dammBuy: 'no graduated pool to test' })
        push({ done: true })
      } catch (e: any) {
        push({ error: e?.message, stack: String(e?.stack).slice(0, 400) })
      }
    })()
  }, [connection])
  return <pre id="sim" style={{ padding: 24, fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(log, null, 2)}</pre>
}
