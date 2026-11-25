/**
 * Uploads a coin's image and its Metaplex-style metadata JSON to Vercel Blob
 * and returns the metadata URI that becomes the token's `uri`.
 * BLOB_READ_WRITE_TOKEN is injected by the connected Vercel Blob store.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { put } from '@vercel/blob'

const MAX_IMAGE_BYTES = 1_000_000
const EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }
const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const url = (v: unknown) => {
  const s = clean(v, 200)
  return /^https?:\/\/\S+$/i.test(s) ? s : ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: 'Storage is not configured' })

  try {
    const body = req.body ?? {}
    const name = clean(body.name, 32)
    const symbol = clean(body.symbol, 10).toUpperCase()
    if (!name || !symbol) return res.status(400).json({ error: 'Name and ticker are required' })

    const m = /^data:image\/(png|jpeg|gif|webp);base64,(.+)$/.exec(String(body.image ?? ''))
    if (!m) return res.status(400).json({ error: 'Image must be PNG, JPG, GIF or WEBP' })
    const bytes = Buffer.from(m[2], 'base64')
    if (bytes.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'Image must be under 1 MB' })

    const slug = symbol.replace(/[^A-Z0-9]/g, '') || 'coin'
    const img = await put(`coins/${slug}.${EXT[m[1]]}`, bytes, {
      access: 'public',
      addRandomSuffix: true,
      contentType: `image/${m[1]}`,
    })

    const twitter = url(body.twitter)
    const telegram = url(body.telegram)
    const website = url(body.website)
    const metadata = {
      name,
      symbol,
      description: clean(body.description, 500),
      image: img.url,
      twitter,
      telegram,
      website,
      extensions: { twitter, telegram, website },
      properties: { files: [{ uri: img.url, type: `image/${m[1]}` }], category: 'image' },
    }
    const json = await put(`coins/${slug}.json`, JSON.stringify(metadata), {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'application/json',
    })

    return res.status(200).json({ uri: json.url, image: img.url })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Upload failed' })
  }
}
