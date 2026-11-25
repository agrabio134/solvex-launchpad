export interface UploadInput {
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
