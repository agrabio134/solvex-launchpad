/**
 * Stores a coin's image + Metaplex-style metadata JSON in Vercel Blob and returns
 * the metadata URI (kept short so the launch transaction stays under the size limit).
 * BLOB_READ_WRITE_TOKEN is injected by the connected Vercel Blob store.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { put } from '@vercel/blob'
import { randomBytes } from 'node:crypto'
import bs58 from 'bs58'

const MAX_IMAGE_BYTES = 1_000_000
const EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }
const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const url = (v: unknown) => {
  const s = clean(v, 200)
  try {
    return s && new URL(s).protocol === 'https:' ? s : ''
  } catch {
    return ''
  }
}
const isWallet = (v: unknown) => {
  try {
    return typeof v === 'string' && bs58.decode(v).length === 32
  } catch {
    return false
  }
}
const magic = (b: Buffer, t: string) =>
  t === 'png'
    ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : t === 'jpeg'
      ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
      : t === 'gif'
        ? b.subarray(0, 3).toString() === 'GIF'
        : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'

// per-instance hourly budgets (abuse brake; Blob quotas cover the aggregate)
const budgets = new Map<string, { until: number; count: number }>()
function take(key: string, limit: number) {
  const now = Date.now()
  for (const [k, b] of budgets) if (b.until <= now) budgets.delete(k)
  const b = budgets.get(key)
  if (b) return b.count++ < limit
  budgets.set(key, { until: now + 3_600_000, count: 1 })
  return true
}
const id = () => bs58.encode(randomBytes(9))

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Image storage is not configured' })
  try {
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Origin rejected' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    if (!isWallet(body.address)) return res.status(401).json({ error: 'Connect your wallet before uploading.' })
    const name = clean(body.name, 32)
    const symbol = clean(body.symbol, 10)
    if (!name || Buffer.byteLength(name, 'utf8') > 32) return res.status(400).json({ error: 'Name must be 1–32 bytes' })
    if (!/^[A-Z0-9]{2,10}$/.test(symbol)) return res.status(400).json({ error: 'Ticker: 2–10 uppercase letters or digits' })

    const m = /^data:image\/(png|jpeg|gif|webp);base64,(.+)$/.exec(String(body.image ?? ''))
    if (!m) return res.status(400).json({ error: 'Image must be PNG, JPG, GIF or WEBP' })
    const bytes = Buffer.from(m[2], 'base64')
    if (bytes.length > MAX_IMAGE_BYTES || bytes.length < 12) return res.status(400).json({ error: 'Image must be under 1 MB' })
    if (!magic(bytes, m[1])) return res.status(400).json({ error: 'That file is not a valid image' })

    const ip = String(req.headers['x-forwarded-for'] || 'local').split(',')[0].trim()
    if (!take(`ip:${ip}`, 30) || !take(`w:${body.address}`, 15)) return res.status(429).json({ error: 'Upload limit reached, try again in an hour.' })

    const img = await put(`i/${id()}.${EXT[m[1]]}`, bytes, { access: 'public', addRandomSuffix: false, contentType: `image/${m[1]}` })
    const twitter = url(body.twitter)
    const telegram = url(body.telegram)
    const website = url(body.website)
    const metadata = {
      name,
      symbol,
      description: clean(body.description, 500),
      image: img.url,
      external_url: website,
      twitter,
      telegram,
      website,
      extensions: { twitter, telegram, website },
      properties: { files: [{ uri: img.url, type: `image/${m[1]}` }], category: 'image' },
    }
    const json = await put(`m/${id()}.json`, JSON.stringify(metadata), { access: 'public', addRandomSuffix: false, contentType: 'application/json' })
    return res.status(200).json({ uri: json.url, image: img.url })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Upload failed, please retry' })
  }
}
