/** TEMPORARY (pump-check branch only): simulate pump.fun launches and trades on mainnet. Sends nothing. */
import { useEffect, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { OnlinePumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk'
import { tokenBalance } from '../lib/chain'
import { parsedTx, buildLaunch, compileForWallet, fetchCoinsByMints, fetchPairMints, prepareSwap, PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID, type Coin } from '../lib/chain'

const WSOL = 'So11111111111111111111111111111111111111112'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function SimCheck() {
  const { connection } = useConnection()
  const [log, setLog] = useState<any[]>([])
  useEffect(() => {
    const out: any[] = []
    const push = (x: any) => {
      out.push(x)
      setLog([...out])
    }
    const sim = async (label: string, build: () => Promise<{ tx: any; signers?: any[]; budget: any; luts?: any[]; extra?: any }>, payer: PublicKey) => {
      try {
        await sleep(1200)
        const b = await build()
        const { blockhash } = await connection.getLatestBlockhash('confirmed')
        const v = compileForWallet(b.tx, payer, blockhash, b.signers ?? [], b.budget, b.luts ?? [])
        const size = v.serialize().length
        const r = await connection.simulateTransaction(v, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' })
        push({ label, size, fits: size <= 1232, ok: !r.value.err, err: r.value.err, units: r.value.unitsConsumed, ...b.extra, logs: r.value.err ? (r.value.logs ?? []).slice(-8) : undefined })
      } catch (e: any) {
        push({ label, error: e?.message, stack: String(e?.stack ?? '').split('\n').slice(0, 14) })
      }
    }
    ;(async () => {
      try {
        const payer = new PublicKey('9qt9RoMpRpg8eLPNNYGqTiqCKifDtHefvMXudf6PEc8p') // funded address, simulation only
        push({ payer: payer.toBase58(), payerSol: (await connection.getBalance(payer)) / 1e9 })
        const pairs = [...(await fetchPairMints(connection))]
        push({ pairs })
        const uri = 'https://2n294j50bru6m0pn.public.blob.vercel-storage.com/m/test.json'
        await sim('LAUNCH SOL pair, no buy', async () => ({ ...(await buildLaunch(connection, payer, { quoteMint: WSOL, name: 'Simulation Coin Max Length Name!', symbol: 'SIMCOINXYZ', uri })), budget: 'launch' }), payer)
        for (const q of pairs.filter((m) => m !== WSOL).slice(0, 3)) await sim(`LAUNCH ${q.slice(0, 6)} pair, no buy`, async () => ({ ...(await buildLaunch(connection, payer, { quoteMint: q, name: 'Simulation Coin Max Length Name!', symbol: 'SIMCOINXYZ', uri })), budget: 'launch' }), payer)

        // recent pump.fun coins (curve) and PumpSwap coins (graduated), with a holder for sells
        const holders = new Map<string, { owner: string; amount: number }>()
        const collect = async (program: PublicKey) => {
          const sigs = await connection.getSignaturesForAddress(program, { limit: 25 })
          const txs = await Promise.all(sigs.filter((s) => !s.err).slice(0, 20).map((s) => parsedTx(connection, s.signature)))
          txs.forEach((t) => (t?.meta?.postTokenBalances ?? []).forEach((b) => {
            const amt = b.uiTokenAmount.uiAmount ?? 0
            if (b.mint.endsWith('pump') && b.owner && amt > 1000 && !holders.has(b.mint) && t!.transaction.message.accountKeys.some((k) => k.signer && k.pubkey.toBase58() === b.owner)) holders.set(b.mint, { owner: b.owner, amount: amt })
          }))
        }
        await collect(PUMP_PROGRAM_ID)
        await sleep(1500)
        await collect(PUMP_PROGRAM_ID)
        await sleep(1500)
        await collect(PUMP_AMM_PROGRAM_ID)
        const coins = await fetchCoinsByMints(connection, [...holders.keys()].slice(0, 30))
        const online = new OnlinePumpSdk(connection)
        for (const c of coins.filter((c) => !c.complete)) { const bc = await online.fetchBondingCurve(c.mint); push({ raw: c.mint, vT: bc.virtualTokenReserves.toString(), vQ: bc.virtualQuoteReserves.toString(), rT: bc.realTokenReserves.toString(), rQ: bc.realQuoteReserves.toString(), sup: bc.tokenTotalSupply.toString(), q: bc.quoteMint.toBase58(), mayhem: bc.isMayhemMode, depth: bc.depth, pcb: bc.postCompleteBaseOut.toString() }); void bondingCurvePda }
        push({ found: coins.map((c) => ({ m: c.mint, s: c.symbol, q: c.quoteMint.slice(0, 5), complete: c.complete, migrated: c.migrated, prog: +(c.progress * 100).toFixed(1), price: c.priceSvx, mcap: c.mcapSvx, reserve: c.reserveSvx, thr: c.thresholdSvx, fee: c.creatorFeeSvx })) })
        const curveSol = coins.filter((c) => !c.complete && c.quoteMint === WSOL).slice(0, 2)
        const curveTok = coins.filter((c) => !c.complete && c.quoteMint !== WSOL).slice(0, 1)
        const grad = coins.filter((c) => c.migrated).slice(0, 2)
        const trade = (c: Coin, side: 'buy' | 'sell', amount: string, owner: PublicKey, via: 'sol' | 'pair') =>
          sim(`${side.toUpperCase()} ${amount} ${side === 'buy' ? 'SOL' : 'tokens'} $${c.symbol} [${c.complete ? 'graduated' : 'curve'}${c.quoteMint !== WSOL ? ', pair ' + c.quoteMint.slice(0, 5) : ''}, via ${via}]`, async () => {
            const p = await prepareSwap(connection, c, side, amount, 300, owner, via)
            return { tx: p.tx, budget: p.budget, luts: p.luts, extra: { out: p.out, minOut: p.minOut, impact: p.priceImpact, route: p.route } }
          }, owner)
        for (const c of [...curveSol, ...curveTok, ...grad]) {
          await trade(c, 'buy', '0.01', payer, 'sol')
          if (c.quoteMint !== WSOL && !c.complete) await trade(c, 'buy', '0.5', payer, 'pair')
          const h = holders.get(c.mint)!
          const bal = await tokenBalance(connection, new PublicKey(h.owner), new PublicKey(c.mint))
          if (bal > 1) await trade(c, 'sell', String(Math.floor(bal / 10)), new PublicKey(h.owner), 'sol')
          else push({ label: `SELL $${c.symbol}`, skipped: 'holder has no tokens now' })
        }
        push({ done: true })
      } catch (e: any) {
        push({ fatal: e?.message, stack: String(e?.stack ?? '').split('\n').slice(0, 4) })
      }
    })()
  }, [connection])
  return (
    <div className="wrap page">
      <h1>pump.fun simulation check</h1>
      <pre id="simlog" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(log, null, 1)}</pre>
    </div>
  )
}
