/**
 * USD price of a Solana token (pair assets), from GeckoTerminal with a short cache.
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

async function gecko(mint: string) {
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/${mint}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
    if (!r.ok) return 0
    const v = Number((await r.json())?.data?.attributes?.token_prices?.[mint])
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

async function jupiter(mint: string) {
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
    if (!r.ok) return 0
    const v = Number((await r.json())?.[mint]?.usdPrice)
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
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
      usd = (await gecko(key)) || (await jupiter(key))
      if (!usd) throw new Error('No USD price for this token right now, retry shortly')
      if (cache.size > 500) cache.clear()
      cache.set(key, { expires: Date.now() + 30_000, usd })
    }
    res.setHeader('Cache-Control', 'public, s-maxage=20')
    return res.status(200).json({ mint: key, usd, asOf: Date.now(), source: 'GeckoTerminal / Jupiter' })
  } catch (e: any) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(503).json({ error: e?.message || 'Price unavailable' })
  }
}
