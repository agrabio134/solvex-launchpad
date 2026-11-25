/**
 * Vercel serverless function: pins the coin image + Metaplex-style JSON to IPFS via Pinata
 * and returns the metadata URI used as the token `uri`.
 * Keeps PINATA_JWT on the server. Run locally with `vercel dev`.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'

const MAX_IMAGE_BYTES = 1_000_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const jwt = process.env.PINATA_JWT
  const gateway = (process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud').replace(/\/$/, '')
  if (!jwt) return res.status(500).json({ error: 'PINATA_JWT not configured' })

  try {
    const { name, symbol, description = '', image, twitter = '', telegram = '', website = '' } = req.body ?? {}
    if (!name || !symbol || !image) return res.status(400).json({ error: 'name, symbol and image are required' })
    if (String(name).length > 32 || String(symbol).length > 10) return res.status(400).json({ error: 'name ≤ 32, ticker ≤ 10 chars' })

    const m = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/.exec(image)
    if (!m) return res.status(400).json({ error: 'image must be a png, jpg, gif or webp data URL' })
    const bytes = Buffer.from(m[3], 'base64')
    if (bytes.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'image must be under 1 MB' })

    // 1) image
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: m[1] }), `${symbol}.${m[2] === 'jpeg' ? 'jpg' : m[2]}`)
    const imgRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    })
    if (!imgRes.ok) throw new Error(`image upload failed: ${await imgRes.text()}`)
    const imageUri = `${gateway}/ipfs/${(await imgRes.json()).IpfsHash}`

    // 2) metadata json
    const metadata = {
      name,
      symbol,
      description,
      image: imageUri,
      twitter,
      telegram,
      website,
      extensions: { twitter, telegram, website },
      createdOn: 'https://solvex.fun',
    }
    const jsonRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinataContent: metadata, pinataMetadata: { name: `${symbol}-metadata.json` } }),
    })
    if (!jsonRes.ok) throw new Error(`metadata upload failed: ${await jsonRes.text()}`)
    const uri = `${gateway}/ipfs/${(await jsonRes.json()).IpfsHash}`

    return res.status(200).json({ uri, image: imageUri })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'upload failed' })
  }
}
