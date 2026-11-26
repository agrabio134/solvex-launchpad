/**
 * Flip's list of markets: the pump.fun coins launched from Flip.
 *
 *  GET              → { coins: [{ mint, creator, quoteMint, createdAt, hidden? }] }   (?all=1 keeps hidden ones)
 *  POST { mint }    → adds a coin after checking on-chain that it is a pump.fun coin whose metadata
 *                     was uploaded through Flip (our Blob store), so the list only holds Flip launches.
 *  POST { op: 'hide' | 'show', mint, message, signature } → admin only: the message must be signed by the
 *                     admin wallet, name the action and mint, and be less than 10 minutes old.
 *
 * Stored in Vercel Blob as empty marker files, so one list() call returns everything:
 *   coins/<mint>/<createdAt>_<creator>_<quoteMint>    hidden/<mint>
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { del, list, put } from '@vercel/blob'
import { createHash } from 'node:crypto'
import { ed25519 } from '@noble/curves/ed25519'
import bs58 from 'bs58'

// no @solana/web3.js here: it fails to load in Vercel's Node runtime (ESM-only dependency)
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
const ZERO = '11111111111111111111111111111111'
const b58 = (b: Uint8Array) => bs58.encode(b)

/** Solana program-derived address: first bump whose hash is off the ed25519 curve. */
function pda(seeds: Uint8Array[], program: string) {
  const prog = bs58.decode(program)
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash('sha256')
    seeds.forEach((x) => h.update(x))
    h.update(Uint8Array.of(bump)).update(prog).update('ProgramDerivedAddress')
    const out = h.digest()
    try {
      ed25519.ExtendedPoint.fromHex(out)
    } catch {
      return b58(out)
    }
  }
  throw new Error('no PDA')
}
const WSOL = 'So11111111111111111111111111111111111111112'
const ADMIN = process.env.VITE_PLATFORM_WALLET || 'C1rdVXhfUe3RDNxMFrGYSHN6MpkhjTLhVaBk3ZpMJWnT'
const endpoint = () => process.env.RPC_URL || process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com'

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`)
  const j = await r.json()
  if (j.error) throw new Error(j.error.message || 'RPC error')
  return j.result
}

/** A base58 32-byte address, or null. */
const pk = (v: unknown) => {
  try {
    return typeof v === 'string' && bs58.decode(v).length === 32 ? v : null
  } catch {
    return null
  }
}

/** Host of this project's Blob store, from the token (vercel_blob_rw_<storeId>_<secret>). */
function blobHost() {
  const id = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN || '')?.[1]
  return id ? `${id.toLowerCase()}.public.blob.vercel-storage.com` : null
}

async function allBlobs(prefix: string) {
  const out: { pathname: string; url: string }[] = []
  let cursor: string | undefined
  do {
    const r = await list({ prefix, cursor, limit: 1000 })
    out.push(...r.blobs)
    cursor = r.hasMore ? r.cursor : undefined
  } while (cursor)
  return out
}

let cache: { at: number; coins: any[] } | null = null
async function readAll() {
  if (cache && Date.now() - cache.at < 10_000) return cache.coins
  const [coins, hidden] = await Promise.all([allBlobs('coins/'), allBlobs('hidden/')])
  const hid = new Set(hidden.map((b) => b.pathname.slice(7)))
  const seen = new Set<string>()
  const out = []
  for (const b of coins) {
    const [, mint, rest] = b.pathname.split('/')
    if (!mint || !rest || seen.has(mint)) continue
    const [createdAt, creator, quoteMint] = rest.split('_')
    seen.add(mint)
    out.push({ mint, creator, quoteMint, createdAt: Number(createdAt), ...(hid.has(mint) ? { hidden: true } : {}) })
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  cache = { at: Date.now(), coins: out }
  return out
}

const tries = new Map<string, { until: number; count: number }>()
function take(key: string, limit: number) {
  const now = Date.now()
  for (const [k, b] of tries) if (b.until <= now) tries.delete(k)
  const b = tries.get(key)
  if (b) return b.count++ < limit
  tries.set(key, { until: now + 3_600_000, count: 1 })
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Storage is not configured' })
  try {
    if (req.method === 'GET') {
      if (req.query.fresh) cache = null
      const all = await readAll()
      // ?fresh skips every cache (used right after a launch); otherwise the edge serves it for a few seconds
      res.setHeader('Cache-Control', req.query.fresh ? 'no-store' : 'public, s-maxage=5, stale-while-revalidate=30')
      return res.status(200).json({ coins: req.query.all ? all : all.filter((c) => !c.hidden) })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' })
    res.setHeader('Cache-Control', 'no-store')
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Origin rejected' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    const mint = pk(body.mint)
    if (!mint) return res.status(400).json({ error: 'Invalid mint' })

    /* ---- admin: hide / show ---- */
    if (body.op === 'hide' || body.op === 'show') {
      const message = String(body.message ?? '')
      const m = /^Flip ops: (hide|show) ([1-9A-HJ-NP-Za-km-z]{32,44})\nIssued: (\d{13})$/.exec(message)
      if (!m || m[1] !== body.op || m[2] !== mint || Math.abs(Date.now() - Number(m[3])) > 600_000) return res.status(400).json({ error: 'Stale or malformed request. Try again.' })
      let ok = false
      try {
        ok = ed25519.verify(bs58.decode(String(body.signature ?? '')), new TextEncoder().encode(message), bs58.decode(ADMIN))
      } catch {
        ok = false
      }
      if (!ok) return res.status(401).json({ error: 'Only the admin wallet can do this.' })
      if (body.op === 'hide') await put(`hidden/${mint}`, '1', { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'text/plain' })
      else {
        const urls = (await allBlobs(`hidden/${mint}`)).map((b) => b.url)
        if (urls.length) await del(urls)
      }
      cache = null
      return res.status(200).json({ ok: true })
    }

    /* ---- register a launch ---- */
    const ip = String(req.headers['x-forwarded-for'] || 'local').split(',')[0].trim()
    if (!take(`ip:${ip}`, 60)) return res.status(429).json({ error: 'Too many requests, try again later.' })
    if ((await allBlobs(`coins/${mint}/`)).length) return res.status(200).json({ ok: true, existing: true })

    const curve = pda([Buffer.from('bonding-curve'), bs58.decode(mint)], PUMP)
    const [curveInfo, mintInfo] = await Promise.all([
      rpc('getAccountInfo', [curve, { encoding: 'base64', commitment: 'confirmed' }]),
      rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
    ])
    // freshly confirmed launches can take a moment to show on every RPC node: the client retries on 409
    if (!curveInfo?.value || !mintInfo?.value) return res.status(409).json({ error: 'Not visible on-chain yet' })
    if (curveInfo.value.owner !== PUMP) return res.status(400).json({ error: 'Not a pump.fun coin' })
    const data = Buffer.from(curveInfo.value.data[0], 'base64')
    if (data.length < 115) return res.status(400).json({ error: 'Unexpected curve layout' })
    const creator = b58(data.subarray(49, 81))
    const quoteRaw = b58(data.subarray(83, 115))
    const quoteMint = quoteRaw === ZERO ? WSOL : quoteRaw

    const uri: string = mintInfo.value.data?.parsed?.info?.extensions?.find((e: any) => e.extension === 'tokenMetadata')?.state?.uri ?? ''
    let host = ''
    try {
      host = new URL(uri).host
    } catch {
      /* not a URL */
    }
    const ours = blobHost()
    if (!(ours ? host === ours : host.endsWith('.public.blob.vercel-storage.com'))) return res.status(400).json({ error: 'Only coins launched on Flip can be listed' })

    const createdAt = Math.floor(Date.now() / 1000)
    await put(`coins/${mint}/${createdAt}_${creator}_${quoteMint}`, '1', { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'text/plain' })
    cache = null
    return res.status(200).json({ ok: true })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Request failed' })
  }
}
