/**
 * USD price of a Solana token (used for $FLIP), from GeckoTerminal with a short cache.
 * GET /api/market-data?mint=<address>
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import bs58 from 'bs58'

const cache = new Map<string, { expires: number; usd: number }>()
const isAddr = (v: unknown) => {
  try {
    return typeof v === 'string' && bs58.decode(v).length === 32
  } catch {
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  const mint = req.query.mint
  if (!isAddr(mint)) return res.status(400).json({ error: 'Invalid token address' })
  const key = String(mint)
  try {
    const hit = cache.get(key)
    let usd = hit && hit.expires > Date.now() ? hit.usd : 0
    if (!usd) {
      const r = await fetch(`https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/${key}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if (!r.ok) throw new Error(r.status === 429 ? 'Price service busy, retry shortly' : 'Price unavailable')
      const j = await r.json()
      usd = Number(j?.data?.attributes?.token_prices?.[key])
      if (!Number.isFinite(usd) || usd <= 0) throw new Error('No USD price for this token yet')
      if (cache.size > 500) cache.clear()
      cache.set(key, { expires: Date.now() + 30_000, usd })
    }
    res.setHeader('Cache-Control', 'public, s-maxage=20')
    return res.status(200).json({ mint: key, usd, asOf: Date.now(), source: 'GeckoTerminal' })
  } catch (e: any) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(503).json({ error: e?.message || 'Price unavailable' })
  }
}
