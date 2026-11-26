/**
 * Jupiter relay for routing SOL into a market's pair asset (and back) inside one transaction.
 * GET  /api/jup?op=quote&inputMint=..&outputMint=..&amount=..&slippageBps=..
 * POST /api/jup?op=swap-instructions   body: { quoteResponse, userPublicKey }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import bs58 from 'bs58'

const BASE = 'https://lite-api.jup.ag/swap/v1'
const isAddr = (v: unknown) => {
  try {
    return typeof v === 'string' && bs58.decode(v).length === 32
  } catch {
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Origin rejected' })
    const op = req.query.op
    if (op === 'quote' && req.method === 'GET') {
      const { inputMint, outputMint, amount, slippageBps } = req.query
      const maxAccounts = Math.min(40, Math.max(8, Number(req.query.maxAccounts) || 20))
      if (!isAddr(inputMint) || !isAddr(outputMint) || !/^\d{1,20}$/.test(String(amount)) || !/^\d{1,4}$/.test(String(slippageBps)))
        return res.status(400).json({ error: 'Bad quote request' })
      const qs = new URLSearchParams({
        inputMint: String(inputMint),
        outputMint: String(outputMint),
        amount: String(amount),
        slippageBps: String(slippageBps),
        swapMode: 'ExactIn',
        restrictIntermediateTokens: 'true',
        maxAccounts: String(maxAccounts), // leaves room for the Meteora swap in the same transaction
      })
      const r = await fetch(`${BASE}/quote?${qs}`, { signal: AbortSignal.timeout(10_000) })
      const j = await r.json()
      return res.status(r.ok ? 200 : 502).json(r.ok ? j : { error: j?.error || 'No route found' })
    }
    if (op === 'swap-instructions' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      if (!body?.quoteResponse || !isAddr(body.userPublicKey)) return res.status(400).json({ error: 'Bad swap request' })
      const r = await fetch(`${BASE}/swap-instructions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteResponse: body.quoteResponse, userPublicKey: body.userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: false }),
        signal: AbortSignal.timeout(12_000),
      })
      const j = await r.json()
      return res.status(r.ok ? 200 : 502).json(r.ok ? j : { error: j?.error || 'Could not build the route' })
    }
    return res.status(405).json({ error: 'Unsupported' })
  } catch (e: any) {
    return res.status(502).json({ error: e?.message || 'Jupiter unavailable' })
  }
}
