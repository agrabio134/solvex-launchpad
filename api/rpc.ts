/**
 * Solana JSON-RPC proxy. The browser talks to /api/rpc; the real endpoint
 * (with its API key) stays server-side in the RPC_URL env var.
 * Only the read/send methods the app needs are allowed.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'

const ALLOWED = new Set([
  'getAccountInfo',
  'getMultipleAccounts',
  'getProgramAccounts',
  'getBalance',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
  'getTokenSupply',
  'getLatestBlockhash',
  'getSlot',
  'getBlockHeight',
  'getBlockTime',
  'getEpochInfo',
  'getSignaturesForAddress',
  'getSignatureStatuses',
  'getTransaction',
  'getMinimumBalanceForRentExemption',
  'getFeeForMessage',
  'getRecentPrioritizationFees',
  'getGenesisHash',
  'getVersion',
  'isBlockhashValid',
  'simulateTransaction',
  'sendTransaction',
])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const upstream = process.env.RPC_URL
  if (!upstream) return res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'RPC_URL is not configured' } })

  const body = req.body
  const calls = Array.isArray(body) ? body : [body]
  if (!calls.length || calls.length > 100) return res.status(400).json({ error: 'Bad batch size' })
  const bad = calls.find((c: any) => !c || typeof c.method !== 'string' || !ALLOWED.has(c.method))
  if (bad) return res.status(403).json({ jsonrpc: '2.0', id: bad?.id ?? null, error: { code: -32601, message: `Method not allowed: ${bad?.method}` } })

  try {
    const r = await fetch(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const text = await r.text()
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text)
  } catch (e: any) {
    res.status(502).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: e?.message || 'Upstream RPC failed' } })
  }
}
