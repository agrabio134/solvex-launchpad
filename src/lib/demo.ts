import type { Coin } from './dbc'
import { FINAL_STRETCH_AT } from './config'

/**
 * Sample coins shown ONLY when VITE_DBC_CONFIG / VITE_SVX_MINT are not set,
 * so the interface can be previewed before the launchpad config exists.
 * A banner in the app says so whenever these are on screen.
 */
const seed: [string, string, number, number][] = [
  ['Ember Frog', 'EFROG', 0.12, 4],
  ['Lava Cat', 'LCAT', 0.34, 11],
  ['Vortex Dog', 'VDOG', 0.05, 2],
  ['Molten Moo', 'MOO', 0.71, 38],
  ['Ash Hamster', 'ASH', 0.88, 52],
  ['Spark', 'SPRK', 0.66, 75],
  ['Cinder Ape', 'CAPE', 1, 300],
  ['Obsidian', 'OBSD', 1, 900],
  ['Fuse', 'FUSE', 0.21, 19],
  ['Hot Rock', 'ROCK', 0.93, 140],
]

const hue = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360

function avatar(sym: string) {
  const h = hue(sym)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="hsl(${h} 70% 55%)"/><circle cx="58" cy="22" r="26" fill="hsl(${(h + 40) % 360} 90% 70%)" opacity=".7"/><text x="40" y="50" font-family="Arial" font-weight="900" font-size="22" text-anchor="middle" fill="#0d0c0a">${sym.slice(0, 3)}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function demoCoins(): Coin[] {
  const now = Math.floor(Date.now() / 1000)
  const threshold = 85_000
  return seed.map(([name, symbol, progress, minsAgo], i) => {
    const reserve = threshold * progress
    const priceSvx = 0.00003 * (1 + progress * 12)
    const migrated = progress >= 1
    const id = `Demo${symbol}${'x'.repeat(36 - symbol.length)}`.slice(0, 44)
    return {
      pool: `pool-${id}`,
      mint: id,
      creator: 'DemoCreator1111111111111111111111111111111',
      name,
      symbol,
      uri: '',
      image: avatar(symbol),
      description: `${name} is a sample coin used to preview the Solvex board.`,
      priceSvx,
      mcapSvx: priceSvx * 1_000_000_000,
      reserveSvx: reserve,
      thresholdSvx: threshold,
      progress,
      createdAt: now - minsAgo * 60 - i,
      migrated,
      status: migrated ? 'graduated' : progress >= FINAL_STRETCH_AT ? 'final' : 'new',
      creatorFeeSvx: 0,
    }
  })
}
