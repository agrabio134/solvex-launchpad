/**
 * Quote assets a launch can pair with: SOL, USDC plus every
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
let lastGood: Asset[] | null = null

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  const core = [...CORE]
  try {
    if (!cache || Date.now() - cache.time > 300_000) {
      const stocks: Asset[] = []
      const seen = new Set<string>()
      const getPage = async (page: number) => {
        const r = await fetch(`https://api.xstocks.fi/api/v2/public/assets?network=Solana&pageSize=100&page=${page}`, { signal: AbortSignal.timeout(12_000) })
        if (!r.ok) throw new Error('Issuer unavailable')
        return r.json()
      }
      // fetch in parallel batches; stop when a batch reports no further pages or adds nothing new
      for (let start = 0; start < 40; start += 8) {
        const settled = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => getPage(start + i)))
        const batch = settled.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled').map((r) => r.value)
        if (!batch.length && start === 0) throw new Error('Issuer unavailable')
        let added = 0
        let more = false
        for (const data of batch) {
          for (const a of data.nodes ?? []) {
            const d = a.deployments?.find((x: any) => x.network === 'Solana')
            if (d?.address && !seen.has(d.address)) {
              seen.add(d.address)
              stocks.push({ mint: d.address, symbol: a.symbol, name: a.name, logo: a.logo, category: 'stock', halted: !!a.isTradingHalted })
              added++
            }
          }
          more = more || !!data.page?.hasNextPage
        }
        if (!more || added === 0) break
      }
      const rank = (s: string) => {
        const i = PREFERRED.indexOf(s)
        return i < 0 ? 999 : i
      }
      stocks.sort((a, b) => rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol))
      if (!stocks.length) throw new Error('Empty catalogue')
      cache = { time: Date.now(), assets: stocks }
      lastGood = stocks
    }
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400')
    return res.status(200).json({ assets: [...core, ...cache.assets], updatedAt: new Date(cache.time).toISOString() })
  } catch {
    if (lastGood) return res.status(200).json({ assets: [...core, ...lastGood], stale: true })
    return res.status(200).json({ assets: core, error: 'The stock catalogue is temporarily unavailable. Stock pairs are paused; SOL and USDC remain available.' })
  }
}
