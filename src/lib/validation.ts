import BN from 'bn.js'

/** "12.5" -> atomic units, exact (no float rounding). */
export function toAtomic(value: string, decimals: number): BN {
  const v = value.trim()
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error('Enter a positive amount.')
  const [whole, fraction = ''] = v.split('.')
  if (fraction.length > decimals) throw new Error(`This token supports ${decimals} decimal places.`)
  const amount = new BN(whole + fraction.padEnd(decimals, '0'))
  if (amount.isZero() || amount.bitLength() > 64) throw new Error('Amount is outside the supported range.')
  return amount
}

export function fromAtomic(value: BN | string | { toString(): string }, decimals: number): number {
  const s = value.toString().padStart(decimals + 1, '0')
  return Number(decimals ? `${s.slice(0, -decimals)}.${s.slice(-decimals)}` : s)
}

export function validateLaunch(name: string, symbol: string) {
  const n = name.trim()
  if (!n) throw new Error('Enter a token name.')
  if (new TextEncoder().encode(n).length > 32) throw new Error('Name must be at most 32 bytes.')
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error('Ticker: 2–10 uppercase letters or digits.')
}
