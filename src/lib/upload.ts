export interface UploadInput {
  address: string
  name: string
  symbol: string
  description: string
  image: string // data URL
  twitter?: string
  telegram?: string
  website?: string
}

export async function uploadMetadata(input: UploadInput): Promise<{ uri: string; image: string }> {
  const r = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = await r.json().catch(() => ({ error: `Upload endpoint returned ${r.status}` }))
  if (!r.ok) throw new Error(j.error || 'Upload failed')
  return j
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = reject
    fr.readAsDataURL(file)
  })
}

/**
 * Prepares a coin image: square-crops from the centre and scales to at most 512×512,
 * so large photos upload fast and fit the 1 MB limit. Animated GIFs under 1 MB are kept as-is.
 */
export async function prepareImage(file: File): Promise<string> {
  if (file.type === 'image/gif' && file.size <= 1_000_000) return fileToDataUrl(file)
  const src = await fileToDataUrl(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Could not read that image'))
    i.src = src
  })
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const out = Math.min(512, side)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = out
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out)
  for (const q of [0.92, 0.8, 0.65]) {
    const url = canvas.toDataURL('image/webp', q)
    if (url.startsWith('data:image/webp') && url.length * 0.75 < 1_000_000) return url
  }
  return canvas.toDataURL('image/png')
}
