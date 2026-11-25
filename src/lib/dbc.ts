/**
 * All Meteora Dynamic Bonding Curve logic for Solvex lives here.
 *
 *  - one DBC config (VITE_DBC_CONFIG) = the Solvex launchpad. Quote mint is $SVX.
 *  - every coin = one DBC virtual pool on that config.
 *  - when a pool's SVX reserve hits the config's migrationQuoteThreshold the curve
 *    completes and Meteora's keeper migrates it to a DAMM v2 pool on Solana (graduation).
 */
import BN from 'bn.js'
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type Commitment,
} from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import {
  DynamicBondingCurveClient,
  getCurrentPoint,
  getPriceFromSqrtPrice,
  type PoolConfig,
  type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { DBC_CONFIG, DEMO, FINAL_STRETCH_AT, SVX_DECIMALS, SVX_MINT } from './config'
import { demoCoins } from './demo'

export type CoinStatus = 'new' | 'final' | 'graduated'

export interface Coin {
  pool: string
  mint: string
  creator: string
  name: string
  symbol: string
  uri: string
  image?: string
  description?: string
  twitter?: string
  telegram?: string
  website?: string
  priceSvx: number
  mcapSvx: number
  reserveSvx: number
  thresholdSvx: number
  progress: number
  createdAt?: number
  migrated: boolean
  status: CoinStatus
  creatorFeeSvx: number
}

const COMMITMENT: Commitment = 'confirmed'
let _client: DynamicBondingCurveClient | null = null
let _clientConn: Connection | null = null
export function dbc(connection: Connection) {
  if (!_client || _clientConn !== connection) {
    _client = new DynamicBondingCurveClient(connection, COMMITMENT)
    _clientConn = connection
  }
  return _client
}

/* ------------------------------------------------------------------ config */

let _config: PoolConfig | null = null
export async function getLaunchConfig(connection: Connection): Promise<PoolConfig> {
  if (_config) return _config
  if (!DBC_CONFIG) throw new Error('VITE_DBC_CONFIG is not set')
  const cfg = await dbc(connection).state.getPoolConfig(DBC_CONFIG)
  if (!cfg) throw new Error('DBC config account not found on this RPC')
  _config = cfg
  return cfg
}

const toNum = (v: { toString(): string }, decimals: number) => Number(v.toString()) / 10 ** decimals

/* -------------------------------------------------------- token metadata */

const METAPLEX = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
const metadataPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('metadata'), METAPLEX.toBuffer(), mint.toBuffer()], METAPLEX)[0]

function parseMetaplex(data: Buffer) {
  let o = 1 + 32 + 32
  const str = () => {
    const len = data.readUInt32LE(o)
    o += 4
    const s = data.subarray(o, o + len).toString('utf8').replace(/\0/g, '').trim()
    o += len
    return s
  }
  return { name: str(), symbol: str(), uri: str() }
}

const jsonCache = new Map<string, Promise<any>>()
function fetchJson(uri: string) {
  if (!uri) return Promise.resolve(null)
  if (!jsonCache.has(uri)) {
    jsonCache.set(
      uri,
      fetch(uri)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    )
  }
  return jsonCache.get(uri)!
}

/* ------------------------------------------------------------------ coins */

function toCoin(poolKey: PublicKey, vp: VirtualPool, cfg: PoolConfig, meta: { name: string; symbol: string; uri: string }): Coin {
  const pool = vp.poolState
  const tokenDecimal = cfg.tokenDecimal
  const priceSvx = Number(getPriceFromSqrtPrice(pool.sqrtPrice, tokenDecimal, SVX_DECIMALS).toString())
  const supply = toNum(cfg.postMigrationTokenSupply, tokenDecimal) || 1_000_000_000
  const reserveSvx = toNum(pool.quoteReserve, SVX_DECIMALS)
  const thresholdSvx = toNum(cfg.migrationQuoteThreshold, SVX_DECIMALS)
  const progress = thresholdSvx > 0 ? Math.min(1, reserveSvx / thresholdSvx) : 0
  const migrated = pool.isMigrated === 1 || progress >= 1
  return {
    pool: poolKey.toBase58(),
    mint: pool.baseMint.toBase58(),
    creator: pool.creator.toBase58(),
    name: meta.name || 'Unnamed',
    symbol: meta.symbol || '???',
    uri: meta.uri,
    priceSvx,
    mcapSvx: priceSvx * supply,
    reserveSvx,
    thresholdSvx,
    progress,
    // activationType 1 = timestamp: activationPoint is the unix launch time
    createdAt: cfg.activationType === 1 ? Number(pool.activationPoint.toString()) : undefined,
    migrated,
    status: migrated ? 'graduated' : progress >= FINAL_STRETCH_AT ? 'final' : 'new',
    creatorFeeSvx: toNum(pool.creatorQuoteFee, SVX_DECIMALS),
  }
}

async function attachMetadata(connection: Connection, rows: { key: PublicKey; pool: VirtualPool }[], cfg: PoolConfig) {
  const coins: Coin[] = []
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const infos = await connection.getMultipleAccountsInfo(chunk.map((r) => metadataPda(r.pool.poolState.baseMint)))
    chunk.forEach((r, j) => {
      const info = infos[j]
      const meta = info ? parseMetaplex(Buffer.from(info.data)) : { name: '', symbol: '', uri: '' }
      coins.push(toCoin(r.key, r.pool, cfg, meta))
    })
  }
  await Promise.all(
    coins.map(async (c) => {
      const j = await fetchJson(c.uri)
      if (j) {
        c.image = j.image
        c.description = j.description
        c.twitter = j.twitter ?? j.extensions?.twitter
        c.telegram = j.telegram ?? j.extensions?.telegram
        c.website = j.website ?? j.extensions?.website
      }
    }),
  )
  return coins
}

export async function fetchCoins(connection: Connection): Promise<Coin[]> {
  if (DEMO) return demoCoins()
  const cfg = await getLaunchConfig(connection)
  const pools = await dbc(connection).state.getPoolsByConfig(DBC_CONFIG!)
  const coins = await attachMetadata(
    connection,
    pools.map((p) => ({ key: p.publicKey, pool: p.account })),
    cfg,
  )
  return coins.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

export async function fetchCoin(connection: Connection, mintOrPool: string): Promise<Coin | null> {
  if (DEMO) return demoCoins().find((c) => c.mint === mintOrPool || c.pool === mintOrPool) ?? null
  const cfg = await getLaunchConfig(connection)
  const client = dbc(connection)
  let key: PublicKey
  let pool: VirtualPool | null = null
  const byMint = await client.state.getPoolByBaseMint(mintOrPool).catch(() => null)
  if (byMint) {
    key = byMint.publicKey
    pool = byMint.account
  } else {
    key = new PublicKey(mintOrPool)
    pool = await client.state.getPool(key)
  }
  if (!pool) return null
  const [coin] = await attachMetadata(connection, [{ key, pool }], cfg)
  return coin
}

export async function fetchCoinsByCreator(connection: Connection, creator: PublicKey): Promise<Coin[]> {
  if (DEMO) return demoCoins().slice(0, 2)
  const cfg = await getLaunchConfig(connection)
  const pools = await dbc(connection).state.getPoolsByCreator(creator)
  const mine = pools.filter((p) => p.account.poolState.config.equals(DBC_CONFIG!))
  return attachMetadata(connection, mine.map((p) => ({ key: p.publicKey, pool: p.account })), cfg)
}

/* ---------------------------------------------------------------- launch */

export interface LaunchInput {
  name: string
  symbol: string
  uri: string
  firstBuySvx: number
}

/** Builds the create-pool (+ optional first buy) transaction. Returns the tx and the new mint keypair (must co-sign). */
export async function buildLaunchTx(connection: Connection, creator: PublicKey, input: LaunchInput) {
  if (!DBC_CONFIG) throw new Error('Launchpad config missing')
  const mint = Keypair.generate()
  const createPoolParam = {
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
    payer: creator,
    poolCreator: creator,
    config: DBC_CONFIG,
    baseMint: mint.publicKey,
  }
  const buyAmount = new BN(Math.floor(input.firstBuySvx * 10 ** SVX_DECIMALS))
  const tx = await dbc(connection).creator.createPoolWithFirstBuy({
    createPoolParam,
    firstBuyParam: buyAmount.gtn(0)
      ? { buyer: creator, buyAmount, minimumAmountOut: new BN(0), referralTokenAccount: null }
      : undefined,
  })
  await finalize(connection, tx, creator)
  tx.partialSign(mint)
  return { tx, mint }
}

/* ------------------------------------------------------------------ swap */

export interface Quote {
  amountOut: number
  minOut: BN
  fee: number
  amountInRaw: BN
}

export async function quoteSwap(
  connection: Connection,
  poolAddr: string,
  side: 'buy' | 'sell',
  amountIn: number,
  slippageBps: number,
): Promise<Quote> {
  const client = dbc(connection)
  const pool = await client.state.getPool(poolAddr)
  if (!pool) throw new Error('Pool not found')
  const cfg = await client.state.getPoolConfig(pool.poolState.config)
  if (!cfg) throw new Error('Config not found')
  const sell = side === 'sell'
  const inDecimals = sell ? cfg.tokenDecimal : SVX_DECIMALS
  const outDecimals = sell ? SVX_DECIMALS : cfg.tokenDecimal
  const amountInRaw = new BN(Math.floor(amountIn * 10 ** inDecimals).toString())
  const currentPoint = await getCurrentPoint(connection, cfg.activationType)
  const q = client.pool.swapQuote({
    virtualPool: pool,
    config: cfg,
    swapBaseForQuote: sell,
    amountIn: amountInRaw,
    slippageBps,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint,
  })
  return {
    amountOut: toNum(q.outputAmount, outDecimals),
    minOut: q.minimumAmountOut,
    fee: toNum(q.tradingFee, SVX_DECIMALS), // config collects fees in SVX
    amountInRaw,
  }
}

export async function buildSwapTx(
  connection: Connection,
  owner: PublicKey,
  poolAddr: string,
  side: 'buy' | 'sell',
  quote: Quote,
) {
  const tx = await dbc(connection).pool.swap({
    owner,
    pool: new PublicKey(poolAddr),
    amountIn: quote.amountInRaw,
    minimumAmountOut: quote.minOut,
    swapBaseForQuote: side === 'sell',
    referralTokenAccount: null,
  })
  await finalize(connection, tx, owner)
  return tx
}

/* ------------------------------------------------------------ creator fees */

export async function buildClaimCreatorFeeTx(connection: Connection, creator: PublicKey, poolAddr: string) {
  const client = dbc(connection)
  const pool = await client.state.getPool(poolAddr)
  if (!pool) throw new Error('Pool not found')
  const tx = await client.creator.claimCreatorTradingFee({
    creator,
    payer: creator,
    pool: new PublicKey(poolAddr),
    maxBaseAmount: new BN(pool.poolState.creatorBaseFee.toString()),
    maxQuoteAmount: new BN(pool.poolState.creatorQuoteFee.toString()),
  })
  await finalize(connection, tx, creator)
  return tx
}

/* -------------------------------------------------------------- balances */

export async function tokenBalance(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<number> {
  for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const ata = getAssociatedTokenAddressSync(mint, owner, true, program)
    const bal = await connection.getTokenAccountBalance(ata).catch(() => null)
    if (bal) return bal.value.uiAmount ?? 0
  }
  return 0
}

export const svxBalance = (connection: Connection, owner: PublicKey) =>
  SVX_MINT ? tokenBalance(connection, owner, SVX_MINT) : Promise.resolve(0)

export async function recentActivity(connection: Connection, poolAddr: string) {
  if (DEMO) return []
  return connection.getSignaturesForAddress(new PublicKey(poolAddr), { limit: 15 })
}

/* ---------------------------------------------------------------- helpers */

async function finalize(connection: Connection, tx: Transaction, feePayer: PublicKey) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(COMMITMENT)
  tx.feePayer = feePayer
  tx.recentBlockhash = blockhash
  tx.lastValidBlockHeight = lastValidBlockHeight
}
