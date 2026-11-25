/**
 * All Meteora Dynamic Bonding Curve logic for Solvex lives here.
 *
 *  - one DBC config (VITE_DBC_CONFIG) = the Solvex launchpad. Its quote mint is $SVX.
 *  - every coin = one DBC virtual pool on that config.
 *  - when a pool's SVX reserve reaches the config's migrationQuoteThreshold the curve
 *    completes and Meteora's keeper migrates it to a locked DAMM v2 pool on Solana.
 */
import BN from 'bn.js'
import { Connection, Keypair, PublicKey, Transaction, type Commitment, type ParsedTransactionWithMeta } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithMarketCap,
  CollectFeeMode,
  DynamicBondingCurveClient,
  getCurrentPoint,
  getPriceFromSqrtPrice,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  type PoolConfig,
  type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { DBC_CONFIG, FINAL_STRETCH_AT } from './config'

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

export interface Launchpad {
  config: PoolConfig
  quoteMint: PublicKey
  quoteDecimals: number
  feePct: number
  creatorSharePct: number
  thresholdSvx: number
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

const toNum = (v: { toString(): string }, decimals: number) => Number(v.toString()) / 10 ** decimals

/* --------------------------------------------------------------- launchpad */

let _lp: Promise<Launchpad> | null = null
/** Reads the Solvex DBC config once: quote mint ($SVX), its decimals, fees and graduation threshold. */
export function getLaunchpad(connection: Connection): Promise<Launchpad> {
  if (!_lp) {
    _lp = (async () => {
      if (!DBC_CONFIG) throw new Error('VITE_DBC_CONFIG is not set')
      const config = await dbc(connection).state.getPoolConfig(DBC_CONFIG)
      if (!config) throw new Error('Launchpad config not found on this RPC')
      const quoteMint = config.quoteMint
      const decimals = await mintDecimals(connection, quoteMint)
      return {
        config,
        quoteMint,
        quoteDecimals: decimals,
        feePct: Number(config.poolFees.baseFee.cliffFeeNumerator.toString()) / 1e7,
        creatorSharePct: config.creatorTradingFeePercentage,
        thresholdSvx: toNum(config.migrationQuoteThreshold, decimals),
      }
    })()
    _lp.catch(() => (_lp = null))
  }
  return _lp
}

export async function mintDecimals(connection: Connection, mint: PublicKey) {
  const info = await connection.getAccountInfo(mint)
  if (!info) throw new Error('Mint not found')
  return (await getMint(connection, mint, COMMITMENT, info.owner)).decimals
}

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
    jsonCache.set(uri, fetch(uri).then((r) => (r.ok ? r.json() : null)).catch(() => null))
  }
  return jsonCache.get(uri)!
}

/* ------------------------------------------------------------------ coins */

function toCoin(poolKey: PublicKey, vp: VirtualPool, lp: Launchpad, meta: { name: string; symbol: string; uri: string }): Coin {
  const pool = vp.poolState
  const cfg = lp.config
  const priceSvx = Number(getPriceFromSqrtPrice(pool.sqrtPrice, cfg.tokenDecimal, lp.quoteDecimals).toString())
  const supply = toNum(cfg.postMigrationTokenSupply, cfg.tokenDecimal) || 1_000_000_000
  const reserveSvx = toNum(pool.quoteReserve, lp.quoteDecimals)
  const progress = lp.thresholdSvx > 0 ? Math.min(1, reserveSvx / lp.thresholdSvx) : 0
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
    thresholdSvx: lp.thresholdSvx,
    progress,
    createdAt: cfg.activationType === ActivationType.Timestamp ? Number(pool.activationPoint.toString()) : undefined,
    migrated,
    status: migrated ? 'graduated' : progress >= FINAL_STRETCH_AT ? 'final' : 'new',
    creatorFeeSvx: toNum(pool.creatorQuoteFee, lp.quoteDecimals),
  }
}

async function attachMetadata(connection: Connection, rows: { key: PublicKey; pool: VirtualPool }[], lp: Launchpad) {
  const coins: Coin[] = []
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const infos = await connection.getMultipleAccountsInfo(chunk.map((r) => metadataPda(r.pool.poolState.baseMint)))
    chunk.forEach((r, j) => {
      const info = infos[j]
      const meta = info ? parseMetaplex(Buffer.from(info.data)) : { name: '', symbol: '', uri: '' }
      coins.push(toCoin(r.key, r.pool, lp, meta))
    })
  }
  await Promise.all(
    coins.map(async (c) => {
      const j = await fetchJson(c.uri)
      if (j) {
        c.image = j.image
        c.description = j.description
        c.twitter = j.twitter || j.extensions?.twitter
        c.telegram = j.telegram || j.extensions?.telegram
        c.website = j.website || j.extensions?.website
      }
    }),
  )
  return coins
}

export async function fetchCoins(connection: Connection): Promise<Coin[]> {
  const lp = await getLaunchpad(connection)
  const pools = await dbc(connection).state.getPoolsByConfig(DBC_CONFIG!)
  const coins = await attachMetadata(connection, pools.map((p) => ({ key: p.publicKey, pool: p.account })), lp)
  return coins.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

export async function fetchCoin(connection: Connection, mintOrPool: string): Promise<Coin | null> {
  const lp = await getLaunchpad(connection)
  const client = dbc(connection)
  let key: PublicKey
  let pool: VirtualPool | null
  const byMint = await client.state.getPoolByBaseMint(mintOrPool).catch(() => null)
  if (byMint) {
    key = byMint.publicKey
    pool = byMint.account
  } else {
    key = new PublicKey(mintOrPool)
    pool = await client.state.getPool(key)
  }
  if (!pool || !pool.poolState.config.equals(DBC_CONFIG!)) return null
  const [coin] = await attachMetadata(connection, [{ key, pool }], lp)
  return coin
}

export async function fetchCoinsByCreator(connection: Connection, creator: PublicKey): Promise<Coin[]> {
  const lp = await getLaunchpad(connection)
  const pools = await dbc(connection).state.getPoolsByCreator(creator)
  const mine = pools.filter((p) => p.account.poolState.config.equals(DBC_CONFIG!))
  return attachMetadata(connection, mine.map((p) => ({ key: p.publicKey, pool: p.account })), lp)
}

/* ---------------------------------------------------------------- trades */

export interface Trade {
  sig: string
  time: number
  side: 'buy' | 'sell'
  trader: string
  tokens: number
  svx: number
  price: number
}

const WSOL = 'So11111111111111111111111111111111111111112'

/** Recent swaps on a pool, reconstructed from the trader's token balance changes. Newest first. */
export async function fetchTrades(connection: Connection, coin: Coin, limit = 60): Promise<Trade[]> {
  const lp = await getLaunchpad(connection)
  const sigs = (await connection.getSignaturesForAddress(new PublicKey(coin.pool), { limit })).filter((s) => !s.err)
  const txs: (ParsedTransactionWithMeta | null)[] = []
  for (let i = 0; i < sigs.length; i += 20) {
    const batch = await connection.getParsedTransactions(
      sigs.slice(i, i + 20).map((s) => s.signature),
      { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    )
    txs.push(...batch)
  }
  const svxMint = lp.quoteMint.toBase58()
  const trades: Trade[] = []
  txs.forEach((tx, i) => {
    const meta = tx?.meta
    if (!tx || !meta || meta.err) return
    const trader = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58()
    if (!trader) return
    const delta = (mint: string) => {
      const sum = (arr: NonNullable<typeof meta.preTokenBalances>) =>
        arr.filter((b) => b.mint === mint && b.owner === trader).reduce((s, b) => s + (b.uiTokenAmount.uiAmount ?? 0), 0)
      return sum(meta.postTokenBalances ?? []) - sum(meta.preTokenBalances ?? [])
    }
    const dTok = delta(coin.mint)
    if (!dTok) return
    let dSvx = delta(svxMint)
    if (!dSvx && svxMint === WSOL) dSvx = (meta.postBalances[0] - meta.preBalances[0] + meta.fee) / 1e9
    const tokens = Math.abs(dTok)
    const svx = Math.abs(dSvx)
    trades.push({
      sig: sigs[i].signature,
      time: tx.blockTime ?? sigs[i].blockTime ?? 0,
      side: dTok > 0 ? 'buy' : 'sell',
      trader,
      tokens,
      svx,
      price: tokens ? svx / tokens : 0,
    })
  })
  return trades
}

/* ---------------------------------------------------------------- launch */

export interface LaunchInput {
  name: string
  symbol: string
  uri: string
  firstBuySvx: number
}

/** Create-pool (+ optional first buy, same tx). Returns the tx and the new mint keypair, which co-signs. */
export async function buildLaunchTx(connection: Connection, creator: PublicKey, input: LaunchInput) {
  const lp = await getLaunchpad(connection)
  const mint = Keypair.generate()
  const buyAmount = new BN(Math.floor(input.firstBuySvx * 10 ** lp.quoteDecimals).toString())
  const tx = await dbc(connection).creator.createPoolWithFirstBuy({
    createPoolParam: {
      name: input.name,
      symbol: input.symbol,
      uri: input.uri,
      payer: creator,
      poolCreator: creator,
      config: DBC_CONFIG!,
      baseMint: mint.publicKey,
    },
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
  priceImpact: number
}

export async function quoteSwap(connection: Connection, poolAddr: string, side: 'buy' | 'sell', amountIn: number, slippageBps: number): Promise<Quote> {
  const lp = await getLaunchpad(connection)
  const client = dbc(connection)
  const pool = await client.state.getPool(poolAddr)
  if (!pool) throw new Error('Pool not found')
  const cfg = lp.config
  const sell = side === 'sell'
  const inDec = sell ? cfg.tokenDecimal : lp.quoteDecimals
  const outDec = sell ? lp.quoteDecimals : cfg.tokenDecimal
  const amountInRaw = new BN(Math.floor(amountIn * 10 ** inDec).toString())
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
  const amountOut = toNum(q.outputAmount, outDec)
  const spot = Number(getPriceFromSqrtPrice(pool.poolState.sqrtPrice, cfg.tokenDecimal, lp.quoteDecimals).toString())
  const exec = sell ? (amountIn ? amountOut / amountIn : 0) : amountOut ? amountIn / amountOut : 0
  return {
    amountOut,
    minOut: q.minimumAmountOut,
    fee: toNum(q.tradingFee, lp.quoteDecimals),
    amountInRaw,
    priceImpact: spot && exec ? Math.abs(exec / spot - 1) : 0,
  }
}

export async function buildSwapTx(connection: Connection, owner: PublicKey, poolAddr: string, side: 'buy' | 'sell', quote: Quote) {
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

/* ---------------------------------------------------------- admin: config */

export interface CurveSettings {
  quoteMint: PublicKey
  quoteDecimals: number
  initialMcap: number
  migrationMcap: number
  feeBps: number
  creatorSharePct: number
  poolCreationFee: number
}

export function buildCurve(s: CurveSettings) {
  return buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: s.quoteDecimals,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: s.feeBps, endingFeeBps: s.feeBps, numberOfPeriod: 0, totalDuration: 0 },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: s.creatorSharePct,
      poolCreationFee: s.poolCreationFee,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    // 100% of graduated LP permanently locked, split between Solvex and the creator
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 50,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 50,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    initialMarketCap: s.initialMcap,
    migrationMarketCap: s.migrationMcap,
  })
}

/** The connected wallet becomes fee claimer + leftover receiver. Returns tx + new config address (co-signed). */
export async function buildCreateConfigTx(connection: Connection, admin: PublicKey, s: CurveSettings) {
  const curve = buildCurve(s)
  const configKp = Keypair.generate()
  const tx = await dbc(connection).partner.createConfig({
    ...curve,
    config: configKp.publicKey,
    feeClaimer: admin,
    leftoverReceiver: admin,
    quoteMint: s.quoteMint,
    payer: admin,
  })
  await finalize(connection, tx, admin)
  tx.partialSign(configKp)
  return { tx, config: configKp.publicKey }
}

/** Partner (Solvex) fee claims for every pool with unclaimed fees, one tx per pool. */
export async function buildPartnerClaimTxs(connection: Connection, admin: PublicKey) {
  const client = dbc(connection)
  const pools = await client.state.getPoolsByConfig(DBC_CONFIG!)
  const out: { pool: string; tx: Transaction }[] = []
  for (const { publicKey, account } of pools) {
    const q = new BN(account.poolState.partnerQuoteFee.toString())
    const b = new BN(account.poolState.partnerBaseFee.toString())
    if (q.isZero() && b.isZero()) continue
    const tx = await client.partner.claimPartnerTradingFee({ pool: publicKey, feeClaimer: admin, payer: admin, maxBaseAmount: b, maxQuoteAmount: q })
    await finalize(connection, tx, admin)
    out.push({ pool: publicKey.toBase58(), tx })
  }
  return out
}

export async function partnerFeesOwed(connection: Connection) {
  const lp = await getLaunchpad(connection)
  const pools = await dbc(connection).state.getPoolsByConfig(DBC_CONFIG!)
  return pools.reduce((s, p) => s + toNum(p.account.poolState.partnerQuoteFee, lp.quoteDecimals), 0)
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

export async function svxBalance(connection: Connection, owner: PublicKey) {
  const lp = await getLaunchpad(connection)
  return tokenBalance(connection, owner, lp.quoteMint)
}

/* ---------------------------------------------------------------- helpers */

async function finalize(connection: Connection, tx: Transaction, feePayer: PublicKey) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(COMMITMENT)
  tx.feePayer = feePayer
  tx.recentBlockhash = blockhash
  tx.lastValidBlockHeight = lastValidBlockHeight
}
