/**
 * Solana mainnet JSON-RPC relay. The browser calls /api/rpc; the real endpoint
 * (RPC_URL, e.g. Helius with its key) stays server-side. Never holds or uses a private key.
 * Only the methods the app needs; program scans limited to filtered DBC / DAMM v2 queries.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const PROGRAMS = new Set(['dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN', 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'])
const METHODS = new Set([
  'getGenesisHash', 'getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts', 'getLatestBlockhash', 'getBlockHeight',
  'getBalance', 'getSlot', 'getBlockTime', 'getEpochInfo', 'getMinimumBalanceForRentExemption', 'getFeeForMessage',
  'getTokenAccountsByOwner', 'getTokenAccountBalance', 'getTokenSupply', 'getSignatureStatuses', 'getSignaturesForAddress',
  'getTransaction', 'simulateTransaction', 'sendTransaction', 'getRecentPrioritizationFees', 'isBlockhashValid', 'getVersion',
])

const callers = new Map<string, { time: number; count: number }>()
let checkedAt = 0

function valid(call: any) {
  if (!call || call.jsonrpc !== '2.0' || !METHODS.has(call.method)) return false
  if (call.method === 'getProgramAccounts') return PROGRAMS.has(call.params?.[0]) && call.params?.[1]?.filters?.some((f: any) => f.memcmp)
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const origin = req.headers.origin
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Origin rejected' })
    } catch {
      return res.status(403).json({ error: 'Origin rejected' })
    }
  }
  const ip = String(req.headers['x-forwarded-for'] || 'local').split(',')[0]
  const now = Date.now()
  if (callers.size > 5000) callers.clear()
  const b = callers.get(ip)
  if (!b || now - b.time > 60_000) callers.set(ip, { time: now, count: 1 })
  else if (++b.count > 400) return res.status(429).json({ error: 'Too many requests, wait a minute.' })

  const endpoint = process.env.RPC_URL || process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com'
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const calls = Array.isArray(body) ? body : [body]
  if (!calls.length || calls.length > 25 || JSON.stringify(body).length > 60_000 || !calls.every(valid))
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Unsupported RPC request' } })

  const rpc = async (payload: unknown) => {
    const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25_000) })
    if (!r.ok) throw new Error(`RPC HTTP ${r.status}`)
    return r.json()
  }
  try {
    if (now - checkedAt > 300_000) {
      const g = await rpc({ jsonrpc: '2.0', id: 0, method: 'getGenesisHash' })
      if (g.result !== MAINNET_GENESIS) throw new Error('Wrong network')
      checkedAt = now
    }
    // Batches are split into single calls: many RPCs (including the public one) reject JSON-RPC batches.
    if (Array.isArray(body)) {
      const results = []
      for (let i = 0; i < body.length; i += 5) {
        results.push(
          ...(await Promise.all(
            body.slice(i, i + 5).map((call: any) => rpc(call).catch((e) => ({ jsonrpc: '2.0', id: call.id, error: { code: -32000, message: e?.message || 'RPC error' } }))),
          )),
        )
      }
      return res.status(200).json(results)
    }
    return res.status(200).json(await rpc(body))
  } catch (e: any) {
    return res.status(503).json({ jsonrpc: '2.0', id: Array.isArray(body) ? null : body?.id ?? null, error: { code: -32000, message: `Mainnet RPC unavailable (${e?.message || 'error'}). Set a dedicated RPC_URL.` } })
  }
}
