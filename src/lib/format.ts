export const short = (a: string, n = 4) => (a.length > n * 2 + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a)

export function compact(n: number, digits = 2): string {
  if (!isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(digits) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(digits) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(digits) + 'K'
  if (abs >= 1) return n.toFixed(digits)
  if (abs === 0) return '0'
  if (abs < 0.0001) return '<0.0001'
  return n.toPrecision(3)
}

/** Tiny prices like 0.0000004123 -> 0.0₆4123 */
export function price(n: number): string {
  if (!isFinite(n) || n === 0) return '0'
  if (n >= 0.01) return n.toFixed(4)
  const s = n.toFixed(20)
  const m = s.match(/^0\.(0+)(\d{1,4})/)
  if (!m) return n.toPrecision(3)
  const zeros = m[1].length
  const sub = String(zeros).split('').map((d) => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('')
  return `0.0${sub}${m[2]}`
}

export function ago(sec?: number): string {
  if (!sec) return '—'
  const d = Math.max(0, Date.now() / 1000 - sec)
  if (d < 60) return `${Math.floor(d)}s`
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  return `${Math.floor(d / 86400)}d`
}

export const pct = (p: number) => `${(Math.min(1, Math.max(0, p)) * 100).toFixed(1)}%`
