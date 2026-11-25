/**
 * Quote assets a launch can pair with: SOL, USDC (and $FLIP when configured) plus every
 * tokenized stock / ETF the xStocks issuer has deployed on Solana. Cached for 5 minutes.
 * GET /api/assets
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'

type Asset = { mint: string; symbol: string; name: string; category: 'crypto' | 'stock'; logo?: string; halted?: boolean }

const CORE: Asset[] = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', category: 'crypto' },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', category: 'crypto' },
]
const PREFERRED = ['NVDAx', 'AAPLx', 'TSLAx', 'SPYx', 'QQQx', 'MSTRx', 'AMZNx', 'GOOGLx', 'METAx', 'MSFTx', 'COINx']

let cache: { time: number; assets: Asset[] } | null = null

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  const core = [...CORE]
  const flip = process.env.VITE_FLIP_MINT
  if (flip) core.unshift({ mint: flip, symbol: 'FLIP', name: 'Flip', category: 'crypto' })
  try {
    if (!cache || Date.now() - cache.time > 300_000) {
      const stocks: Asset[] = []
      for (let page = 0; page < 30; page++) {
        const r = await fetch(`https://api.xstocks.fi/api/v2/public/assets?network=Solana&pageSize=100&page=${page}`, { signal: AbortSignal.timeout(12_000) })
        if (!r.ok) throw new Error('Issuer unavailable')
        const data = await r.json()
        for (const a of data.nodes ?? []) {
          const d = a.deployments?.find((x: any) => x.network === 'Solana')
          if (d?.address) stocks.push({ mint: d.address, symbol: a.symbol, name: a.name, logo: a.logo, category: 'stock', halted: !!a.isTradingHalted })
        }
        if (!data.page?.hasNextPage) break
      }
      const rank = (s: string) => {
        const i = PREFERRED.indexOf(s)
        return i < 0 ? 999 : i
      }
      stocks.sort((a, b) => rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol))
      cache = { time: Date.now(), assets: stocks }
    }
    res.setHeader('Cache-Control', 'public, s-maxage=120')
    return res.status(200).json({ assets: [...core, ...cache.assets], updatedAt: new Date(cache.time).toISOString() })
  } catch {
    return res.status(200).json({ assets: core, error: 'The stock catalogue is temporarily unavailable. Stock pairs are paused; SOL and USDC remain available.' })
  }
}
