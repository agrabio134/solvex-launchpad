/**
 * Flip on-chain logic (Meteora Dynamic Bonding Curve + DAMM v2), FirePad model:
 *
 *  - every launch creates its OWN DBC config + pool in one atomic transaction.
 *    quote mint = $FLIP, fee claimer / leftover receiver = the platform wallet.
 *  - markets are discovered from the configs owned by the platform wallet whose quote mint is $FLIP.
 *  - opening / graduation market caps are fixed in USD and converted to $FLIP at launch.
 *  - once the curve fills, anyone can migrate it to a locked Meteora DAMM v2 pool;
 *    after that, trades route through DAMM v2.
 *
 * Field names ending in "Svx" hold $FLIP amounts (kept for compatibility).
 */
import BN from 'bn.js'
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  TransactionInstruction,
  TransactionMessage,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js'
import {
  AccountState,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getDefaultAccountState,
  getExtensionTypes,
  getPausableConfig,
  getTransferFeeConfig,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from '@solana/spl-token'
import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithMarketCap,
  CollectFeeMode,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress,
  deriveDbcPoolAddress,
  deriveTokenBadgeAddress,
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
import { CpAmm } from '@meteora-ag/cp-amm-sdk'
import {
  FINAL_STRETCH_AT,
  LISTED_AFTER,
  WSOL_MINT,
  GRAD_MCAP_FLIP,
  GRAD_MCAP_USD,
  MAINNET_GENESIS,
  OPEN_MCAP_FLIP,
  OPEN_MCAP_USD,
  PLATFORM_WALLET,
} from './config'
import { fromAtomic, toAtomic, validateLaunch } from './validation'
import { explainSimulation, UserError } from './errors'

export type CoinStatus = 'new' | 'final' | 'graduated'

export interface Coin {
  quoteMint: string
  pool: string
  config: string
  tradingPool: string
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
  /** curve filled (trading on the curve stopped) */
  complete: boolean
  /** liquidity moved to DAMM v2 */
  migrated: boolean
  status: CoinStatus
  creatorFeeSvx: number
  partnerFeeSvx: number
}

export interface Asset {
  mint: string
  symbol: string
  name: string
  category: 'crypto' | 'stock'
  logo?: string
  halted?: boolean
}

export const CORE_ASSETS: Asset[] = [
  { mint: WSOL_MINT.toBase58(), symbol: 'SOL', name: 'Solana', category: 'crypto' },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', category: 'crypto' },
]

let _assets: Promise<{ assets: Asset[]; error?: string }> | null = null
/** SOL, USDC, $FLIP (when live) and the xStocks tokenized-stock catalogue. */
export function fetchAssets(): Promise<{ assets: Asset[]; error?: string }> {
  if (!_assets) {
    _assets = fetch('/api/assets', { signal: AbortSignal.timeout(45000) })
      .then((r) => r.json())
      .then((d) => ({ assets: d.assets?.length ? d.assets : CORE_ASSETS, error: d.error }))
      .catch(() => ({ assets: CORE_ASSETS, error: 'Stock catalogue unavailable right now.' }))
    _assets.then((r) => r.error && setTimeout(() => (_assets = null), 30000))
  }
  return _assets
}

const U64_MAX = new BN('18446744073709551615')

const clients = new WeakMap<Connection, { dbc: DynamicBondingCurveClient; amm: CpAmm }>()
function sdk(connection: Connection) {
  let c = clients.get(connection)
  if (!c) {
    c = { dbc: new DynamicBondingCurveClient(connection, 'confirmed'), amm: new CpAmm(connection) }
    clients.set(connection, c)
  }
  return c
}

/* ------------------------------------------------------------- mints */

const mintCache = new Map<string, Promise<{ decimals: number; program: PublicKey; supply: bigint }>>()
export function mintInfo(connection: Connection, mint: PublicKey) {
  const key = mint.toBase58()
  if (!mintCache.has(key)) {
    const p = (async () => {
      const acc = await connection.getAccountInfo(mint)
      if (!acc || (!acc.owner.equals(TOKEN_PROGRAM_ID) && !acc.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Not a Solana token mint')
      const info = unpackMint(mint, acc, acc.owner)
      const hook = getTransferHook(info)
      const fee = getTransferFeeConfig(info)
      if (getExtensionTypes(info.tlvData).includes(ExtensionType.NonTransferable) || getPausableConfig(info)?.paused || getDefaultAccountState(info)?.state === AccountState.Frozen)
        throw new Error('This token is paused, frozen by default or non-transferable')
      if (hook && !hook.programId.equals(PublicKey.default)) throw new Error('Tokens with transfer hooks are not supported')
      if (fee && (fee.olderTransferFee.transferFeeBasisPoints !== 0 || fee.newerTransferFee.transferFeeBasisPoints !== 0))
        throw new Error('Tokens with transfer fees are not supported')
      return { decimals: info.decimals, program: acc.owner, supply: info.supply }
    })()
    p.catch(() => mintCache.delete(key))
    mintCache.set(key, p)
  }
  return mintCache.get(key)!
}

export async function assertMainnet(connection: Connection) {
  if ((await connection.getGenesisHash()) !== MAINNET_GENESIS) throw new Error('RPC is not Solana mainnet. Nothing was sent.')
}

/* --------------------------------------------------------- $FLIP price */

const usdCache = new Map<string, { at: number; p: Promise<number | null> }>()
/** USD price of a quote asset (GeckoTerminal, Jupiter fallback), cached 60s. */
export function quoteUsd(mint: string): Promise<number | null> {
  const hit = usdCache.get(mint)
  if (hit && Date.now() - hit.at < 60000) return hit.p
  const p = fetch(`/api/market-data?mint=${mint}`, { signal: AbortSignal.timeout(12000) })
    .then(async (r) => {
      const j = await r.json()
      return r.ok && Number.isFinite(j.usd) && j.usd > 0 ? (j.usd as number) : null
    })
    .catch(() => null)
  usdCache.set(mint, { at: Date.now(), p })
  return p
}

/** Opening / graduation market caps, in units of the chosen quote asset, for a launch right now. */
export async function launchCaps(quoteMint: string) {
  const usd = await quoteUsd(quoteMint)
  if (usd) return { initialCap: OPEN_MCAP_USD / usd, graduationCap: GRAD_MCAP_USD / usd, usd }
  if (quoteMint !== WSOL_MINT.toBase58() && OPEN_MCAP_FLIP > 0 && GRAD_MCAP_FLIP > OPEN_MCAP_FLIP) return { initialCap: OPEN_MCAP_FLIP, graduationCap: GRAD_MCAP_FLIP, usd: null }
  throw new Error('No live USD price for this pair right now, so the launch size cannot be set. Retry shortly.')
}

/* --------------------------------------------------------- metadata */

const METAPLEX = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
const metadataPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('metadata'), METAPLEX.toBuffer(), mint.toBuffer()], METAPLEX)[0]

function parseMetaplex(data: Buffer) {
  let o = 65
  const str = (max: number) => {
    const len = data.readUInt32LE(o)
    o += 4
    if (len > max || o + len > data.length) throw new Error('bad metadata')
    const s = data.subarray(o, o + len).toString('utf8').replace(/\0/g, '').trim()
    o += len
    return s
  }
  return { name: str(32), symbol: str(10), uri: str(200) }
}

/** IPFS links (ipfs://, ipfs.io/ipfs/…) go through a gateway that serves browsers reliably. */
const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'
const ipfs = (u: string) => {
  if (!u) return u
  if (u.startsWith('ipfs://')) return IPFS_GATEWAY + u.slice(7)
  const m = /^https?:\/\/[^/]+\/ipfs\/(.+)$/.exec(u)
  return m ? IPFS_GATEWAY + m[1] : u
}
const jsonCache = new Map<string, Promise<any>>()
function fetchJson(uri: string) {
  const u = ipfs(uri)
  if (!u) return Promise.resolve(null)
  if (!jsonCache.has(u)) jsonCache.set(u, fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null))
  return jsonCache.get(u)!
}

/* ------------------------------------------------------------- coins */

type Row = { key: PublicKey; pool: VirtualPool; config: PoolConfig }

/** Launched on Flip (not an older pool that shares the platform wallet). */
const listed = (pool: VirtualPool) => Number(pool.poolState.activationPoint.toString()) >= LISTED_AFTER

async function toCoins(connection: Connection, rows: Row[]): Promise<Coin[]> {
  if (!rows.length) return []
  const { amm } = sdk(connection)
  const metas: ({ name: string; symbol: string; uri: string } | null)[] = []
  for (let i = 0; i < rows.length; i += 100) {
    const infos = await connection.getMultipleAccountsInfo(rows.slice(i, i + 100).map((r) => metadataPda(r.pool.poolState.baseMint)))
    infos.forEach((info) => {
      try {
        metas.push(info ? parseMetaplex(Buffer.from(info.data)) : null)
      } catch {
        metas.push(null)
      }
    })
  }

  const coins = await Promise.all(
    rows.map(async (r, i): Promise<Coin> => {
      const s = r.pool.poolState
      const c = r.config
      const qd = (await mintInfo(connection, c.quoteMint)).decimals
      let price = Number(getPriceFromSqrtPrice(s.sqrtPrice, c.tokenDecimal, qd).toString())
      const reserve = fromAtomic(s.quoteReserve, qd)
      const threshold = fromAtomic(c.migrationQuoteThreshold, qd)
      const complete = s.quoteReserve.gte(c.migrationQuoteThreshold)
      const migrated = !!s.isMigrated
      let tradingPool = r.key.toBase58()
      if (migrated) {
        try {
          const addr = deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[c.migrationFeeOption], s.baseMint, c.quoteMint)
          const st = await amm.fetchPoolState(addr)
          const baseIsA = st.tokenAMint.equals(s.baseMint)
          const raw = Number(getPriceFromSqrtPrice(st.sqrtPrice, baseIsA ? c.tokenDecimal : qd, baseIsA ? qd : c.tokenDecimal).toString())
          price = baseIsA ? raw : 1 / raw
          tradingPool = addr.toBase58()
        } catch {
          /* keep curve price */
        }
      }
      const supply = fromAtomic(c.postMigrationTokenSupply, c.tokenDecimal) || 1_000_000_000
      const progress = threshold > 0 ? Math.min(1, reserve / threshold) : 0
      const m = metas[i]
      return {
        quoteMint: c.quoteMint.toBase58(),
        pool: r.key.toBase58(),
        config: s.config.toBase58(),
        tradingPool,
        mint: s.baseMint.toBase58(),
        creator: s.creator.toBase58(),
        name: m?.name || 'Unnamed',
        symbol: m?.symbol || '???',
        uri: m?.uri || '',
        priceSvx: price,
        mcapSvx: price * supply,
        reserveSvx: reserve,
        thresholdSvx: threshold,
        progress: complete ? 1 : progress,
        createdAt: c.activationType === ActivationType.Timestamp ? Number(s.activationPoint.toString()) : undefined,
        complete,
        migrated,
        status: complete || migrated ? 'graduated' : progress >= FINAL_STRETCH_AT ? 'final' : 'new',
        creatorFeeSvx: fromAtomic(s.creatorQuoteFee, qd),
        partnerFeeSvx: fromAtomic(s.partnerQuoteFee, qd),
      }
    }),
  )

  await Promise.all(
    coins.map(async (c) => {
      const j = await fetchJson(c.uri)
      if (!j) return
      c.image = ipfs(j.image)
      c.description = j.description
      c.twitter = j.twitter || j.extensions?.twitter
      c.telegram = j.telegram || j.extensions?.telegram
      c.website = j.website || j.external_url || j.extensions?.website
    }),
  )
  return coins
}

/** All $FLIP configs created through Flip (fee claimer = platform wallet). Cached briefly. */
let _cfgs: { at: number; list: Promise<{ key: PublicKey; config: PoolConfig }[]> } | null = null
async function platformConfigs(connection: Connection) {
  if (!_cfgs || Date.now() - _cfgs.at > 20000) {
    const list = sdk(connection)
      .dbc.state.getPoolConfigsByOwner(PLATFORM_WALLET)
      .then((all) => all.map((c) => ({ key: c.publicKey, config: c.account })))
    _cfgs = { at: Date.now(), list }
    list.catch(() => (_cfgs = null))
  }
  return _cfgs.list
}

/** All markets on the platform wallet. `includeUnlisted` also returns pools from before go-live (admin only). */
export async function fetchCoins(connection: Connection, opts: { includeUnlisted?: boolean } = {}): Promise<Coin[]> {
  const { dbc } = sdk(connection)
  const cfgs = await platformConfigs(connection)
  const rows: Row[] = []
  for (let i = 0; i < cfgs.length; i += 8) {
    const chunk = cfgs.slice(i, i + 8)
    const res = await Promise.all(chunk.map((c) => dbc.state.getPoolsByConfig(c.key)))
    res.forEach((pools, j) => pools.forEach((p) => (opts.includeUnlisted || listed(p.account)) && rows.push({ key: p.publicKey, pool: p.account, config: chunk[j].config })))
  }
  const coins = await toCoins(connection, rows)
  return coins.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

async function rowFor(connection: Connection, poolKey: PublicKey, pool: VirtualPool): Promise<Row | null> {
  const config = await sdk(connection).dbc.state.getPoolConfig(pool.poolState.config)
  if (!config || !config.feeClaimer.equals(PLATFORM_WALLET)) return null
  return { key: poolKey, pool, config }
}

export async function fetchCoin(connection: Connection, mintOrPool: string): Promise<Coin | null> {
  const { dbc } = sdk(connection)
  let key: PublicKey
  let pool: VirtualPool | null
  const byMint = await dbc.state.getPoolByBaseMint(mintOrPool).catch(() => null)
  if (byMint) {
    key = byMint.publicKey
    pool = byMint.account
  } else {
    try {
      key = new PublicKey(mintOrPool)
    } catch {
      return null
    }
    pool = await dbc.state.getPool(key).catch(() => null)
  }
  if (!pool || !listed(pool)) return null
  const row = await rowFor(connection, key, pool)
  if (!row) return null
  return (await toCoins(connection, [row]))[0]
}

export async function fetchCoinsByCreator(connection: Connection, creator: PublicKey): Promise<Coin[]> {
  const { dbc } = sdk(connection)
  const pools = await dbc.state.getPoolsByCreator(creator)
  const cfgs = new Map((await platformConfigs(connection)).map((c) => [c.key.toBase58(), c.config]))
  const rows = pools
    .filter((p) => cfgs.has(p.account.poolState.config.toBase58()) && listed(p.account))
    .map((p) => ({ key: p.publicKey, pool: p.account, config: cfgs.get(p.account.poolState.config.toBase58())! }))
  return toCoins(connection, rows)
}

/* ------------------------------------------------------------ trades */

const WSOL = 'So11111111111111111111111111111111111111112'

export interface Trade {
  sig: string
  time: number
  side: 'buy' | 'sell'
  trader: string
  tokens: number
  svx: number
  price: number
}

/** Recent swaps (curve, or DAMM v2 once migrated), rebuilt from the trader's balance changes. Newest first. */
export async function fetchTrades(connection: Connection, coin: Coin, limit = 20): Promise<Trade[]> {
  const sigs = (await connection.getSignaturesForAddress(new PublicKey(coin.tradingPool), { limit })).filter((s) => !s.err)
  const txs: (ParsedTransactionWithMeta | null)[] = []
  for (let i = 0; i < sigs.length; i += 10) {
    const part = sigs.slice(i, i + 10)
    try {
      txs.push(...(await connection.getParsedTransactions(part.map((s) => s.signature), { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })))
    } catch {
      txs.push(...part.map(() => null)) // rate-limited: show what we have
    }
  }
  const quote = coin.quoteMint
  const out: Trade[] = []
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
    let dQ = delta(quote)
    // wrapped SOL is opened and closed inside the swap, so read the trader's lamports instead
    if (!dQ && quote === WSOL) {
      const idx = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey.toBase58() === trader)
      if (idx >= 0) dQ = (meta.postBalances[idx] - meta.preBalances[idx] + (idx === 0 ? meta.fee : 0)) / 1e9
    }
    if (!dTok || !dQ || Math.sign(dTok) === Math.sign(dQ)) return
    const tokens = Math.abs(dTok)
    const svx = Math.abs(dQ)
    out.push({ sig: sigs[i].signature, time: tx.blockTime ?? sigs[i].blockTime ?? 0, side: dTok > 0 ? 'buy' : 'sell', trader, tokens, svx, price: svx / tokens })
  })
  return out
}

/* ------------------------------------------------------------ launch */

export interface LaunchParams {
  quoteMint: string
  name: string
  symbol: string
  uri: string
  feeBps: number // 100 – 300
  dynamic: boolean
  shield: boolean // anti-snipe: fee starts at 10% and decays to feeBps over 5 minutes
}

function curveFor(p: LaunchParams, quoteDecimals: number, initialCap: number, graduationCap: number) {
  return buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: quoteDecimals,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: p.shield ? Math.max(1000, p.feeBps) : p.feeBps,
          endingFeeBps: p.feeBps,
          numberOfPeriod: p.shield ? 60 : 0,
          totalDuration: p.shield ? 300 : 0,
        },
      },
      dynamicFeeEnabled: p.dynamic,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.FixedBps100, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
    liquidityDistribution: { partnerLiquidityPercentage: 0, partnerPermanentLockedLiquidityPercentage: 50, creatorLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    initialMarketCap: initialCap,
    migrationMarketCap: graduationCap,
  })
}

/** One atomic tx: new DBC config (quote $FLIP, fee claimer = platform) + the coin's pool. */
export async function buildLaunch(connection: Connection, creator: PublicKey, p: LaunchParams) {
  validateLaunch(p.name, p.symbol)
  if (!Number.isInteger(p.feeBps) || p.feeBps < 100 || p.feeBps > 300) throw new Error('Fee must be 1–3%.')
  const quoteMint = new PublicKey(p.quoteMint)
  const assets = (await fetchAssets()).assets
  const asset = assets.find((a) => a.mint === p.quoteMint)
  if (!asset) throw new Error('Choose a supported pair.')
  if (asset.halted) throw new Error(`The issuer has halted ${asset.symbol}.`)
  const q = await mintInfo(connection, quoteMint)
  const caps = await launchCaps(p.quoteMint)
  if (caps.graduationCap < caps.initialCap * 3) throw new Error('Graduation cap must be at least 3× the opening cap.')
  const curve = curveFor(p, q.decimals, caps.initialCap, caps.graduationCap)
  const config = Keypair.generate()
  const baseMint = Keypair.generate()
  const { dbc } = sdk(connection)
  const badge = q.program.equals(TOKEN_2022_PROGRAM_ID) ? await dbc.state.getTokenBadge(quoteMint).catch(() => null) : null
  const tx = await dbc.partner.createConfigAndPool({
    ...curve,
    config: config.publicKey,
    payer: creator,
    feeClaimer: PLATFORM_WALLET,
    leftoverReceiver: PLATFORM_WALLET,
    quoteMint,
    tokenBadge: badge ? deriveTokenBadgeAddress(quoteMint) : undefined,
    preCreatePoolParam: { name: p.name.trim(), symbol: p.symbol, uri: p.uri, poolCreator: creator, baseMint: baseMint.publicKey },
  })
  const pool = deriveDbcPoolAddress(quoteMint, baseMint.publicKey, config.publicKey).toBase58()
  return { tx, signers: [config, baseMint], pool, mint: baseMint.publicKey.toBase58(), caps }
}

/* -------------------------------------------------------------- swap */

export interface Prepared {
  tx: Transaction
  /** address lookup tables needed to fit routed (Jupiter + Meteora) trades */
  luts: AddressLookupTableAccount[]
  out: number
  minOut: number
  priceImpact: number | null
  route: string
  /** what the user pays with / receives: the pair asset, or SOL routed through Jupiter */
  via: 'pair' | 'sol'
}

type Core = { ixs: TransactionInstruction[]; outRaw: BN; minOutRaw: BN; priceImpact: number | null; route: string }

/** One Meteora swap (curve, or DAMM v2 once graduated) with an exact raw input amount. */
async function coreSwap(connection: Connection, coin: Coin, side: 'buy' | 'sell', amountIn: BN, slippageBps: number, owner: PublicKey): Promise<Core> {
  const { dbc, amm } = sdk(connection)
  const sell = side === 'sell'
  const quoteKey = new PublicKey(coin.quoteMint)
  const baseKey = new PublicKey(coin.mint)
  const base = await mintInfo(connection, baseKey)
  const quote = await mintInfo(connection, quoteKey)
  const pool = await dbc.state.getPool(coin.pool)
  if (!pool) throw new UserError('This market couldn’t be found on-chain. Refresh the page.')
  const config = await dbc.state.getPoolConfig(pool.poolState.config)
  if (!config || !config.feeClaimer.equals(PLATFORM_WALLET)) throw new UserError('This isn’t a Flip market.')

  if (pool.poolState.isMigrated) {
    const address = deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption], baseKey, config.quoteMint)
    const state = await amm.fetchPoolState(address)
    const slot = await connection.getSlot()
    const time = await connection.getBlockTime(slot)
    if (time === null) throw new UserError('Couldn’t read the network time. Try again in a moment.')
    const aIsBase = state.tokenAMint.equals(baseKey)
    const a = aIsBase ? base : quote
    const b = aIsBase ? quote : base
    const input = sell ? baseKey : quoteKey
    const q = amm.getQuote({ inAmount: amountIn, inputTokenMint: input, slippage: slippageBps / 100, poolState: state, currentTime: time, currentSlot: slot, tokenADecimal: a.decimals, tokenBDecimal: b.decimals })
    if (!q.consumedInAmount.eq(amountIn)) throw new UserError('The pool can’t fill this whole amount. Try a smaller amount.')
    const tx = await amm.swap({
      payer: owner,
      pool: address,
      inputTokenMint: input,
      outputTokenMint: sell ? quoteKey : baseKey,
      amountIn,
      minimumAmountOut: q.minSwapOutAmount,
      tokenAMint: state.tokenAMint,
      tokenBMint: state.tokenBMint,
      tokenAVault: state.tokenAVault,
      tokenBVault: state.tokenBVault,
      tokenAProgram: a.program,
      tokenBProgram: b.program,
      referralTokenAccount: null,
      poolState: state,
    })
    return { ixs: tx.instructions, outRaw: q.swapOutAmount, minOutRaw: q.minSwapOutAmount, priceImpact: Number(q.priceImpact.toString()), route: 'Meteora DAMM v2' }
  }

  if (pool.poolState.quoteReserve.gte(config.migrationQuoteThreshold)) throw new UserError('This curve just filled up, so trading on it has stopped. Migrate it to Solana from this page to keep trading.')
  const q = dbc.pool.swapQuote({
    virtualPool: pool,
    config,
    swapBaseForQuote: sell,
    amountIn,
    slippageBps,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint: await getCurrentPoint(connection, config.activationType),
  })
  if (q.minimumAmountOut.isZero()) throw new UserError('That amount is too small to trade. Enter a bigger amount.')
  const tx = await dbc.pool.swap({ owner, pool: new PublicKey(coin.pool), amountIn, minimumAmountOut: q.minimumAmountOut, swapBaseForQuote: sell, referralTokenAccount: null })
  const inDec = sell ? base.decimals : quote.decimals
  const outDec = sell ? quote.decimals : base.decimals
  const amt = fromAtomic(amountIn, inDec)
  const out = fromAtomic(q.outputAmount, outDec)
  const exec = sell ? out / amt : amt / out
  return { ixs: tx.instructions, outRaw: q.outputAmount, minOutRaw: q.minimumAmountOut, priceImpact: coin.priceSvx && exec ? Math.abs(exec / coin.priceSvx - 1) * 100 : null, route: 'Meteora bonding curve' }
}

/* ---- Jupiter (SOL <-> pair asset) ---- */

async function jupQuote(inputMint: string, outputMint: string, amount: BN, slippageBps: number) {
  const r = await fetch(`/api/jup?op=quote&inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippageBps=${slippageBps}`, { signal: AbortSignal.timeout(15000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.outAmount) throw new UserError(`There’s no SOL route for this pair right now${j?.error ? ` (${j.error})` : ''}. Switch “Pay with” to the pair asset, or try a different amount.`)
  return j
}

const toIx = (i: any) =>
  new TransactionInstruction({
    programId: new PublicKey(i.programId),
    keys: i.accounts.map((a: any) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(i.data, 'base64'),
  })

async function jupInstructions(connection: Connection, quoteResponse: any, owner: PublicKey) {
  const r = await fetch('/api/jup?op=swap-instructions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteResponse, userPublicKey: owner.toBase58() }),
    signal: AbortSignal.timeout(15000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.swapInstruction) throw new UserError('Couldn’t build the SOL route right now. Try again, or pay with the pair asset.')
  const ixs: TransactionInstruction[] = [...(j.setupInstructions ?? []).map(toIx), toIx(j.swapInstruction), ...(j.cleanupInstruction ? [toIx(j.cleanupInstruction)] : [])]
  const luts = (await Promise.all((j.addressLookupTableAddresses ?? []).map((a: string) => connection.getAddressLookupTable(new PublicKey(a)).then((r) => r.value)))).filter(Boolean) as AddressLookupTableAccount[]
  return { ixs, luts }
}

/**
 * Builds a buy or sell. `via: 'sol'` lets anyone trade any market with SOL: buying routes
 * SOL → pair asset (Jupiter) → coin (Meteora) in one transaction; selling routes coin → pair asset → SOL.
 * The Jupiter leg uses the Meteora leg's guaranteed minimum, so any small surplus of the pair asset stays in the wallet.
 */
export async function prepareSwap(connection: Connection, coin: Coin, side: 'buy' | 'sell', amount: string, slippageBps: number, owner: PublicKey, via: 'pair' | 'sol' = 'pair'): Promise<Prepared> {
  if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 1000) throw new UserError('Slippage must be between 0.1% and 10%.')
  const sell = side === 'sell'
  const base = await mintInfo(connection, new PublicKey(coin.mint))
  const quote = await mintInfo(connection, new PublicKey(coin.quoteMint))
  const routed = via === 'sol' && coin.quoteMint !== WSOL_MINT.toBase58()

  if (!routed) {
    const inDec = sell ? base.decimals : quote.decimals
    const outDec = sell ? quote.decimals : base.decimals
    const c = await coreSwap(connection, coin, side, toAtomic(amount, inDec), slippageBps, owner)
    return { tx: new Transaction().add(...c.ixs), luts: [], out: fromAtomic(c.outRaw, outDec), minOut: fromAtomic(c.minOutRaw, outDec), priceImpact: c.priceImpact, route: c.route, via }
  }

  // split slippage across the two legs so the total stays within what the user chose
  const leg = Math.max(10, Math.floor(slippageBps / 2))
  if (!sell) {
    const jq = await jupQuote(WSOL_MINT.toBase58(), coin.quoteMint, toAtomic(amount, 9), leg)
    const pairMin = new BN(jq.otherAmountThreshold)
    const c = await coreSwap(connection, coin, 'buy', pairMin, leg, owner)
    const j = await jupInstructions(connection, jq, owner)
    return {
      tx: new Transaction().add(...j.ixs, ...c.ixs),
      luts: j.luts,
      out: fromAtomic(c.outRaw, base.decimals),
      minOut: fromAtomic(c.minOutRaw, base.decimals),
      priceImpact: c.priceImpact != null ? c.priceImpact + Number(jq.priceImpactPct ?? 0) * 100 : null,
      route: `SOL to pair asset via Jupiter, then ${c.route}`,
      via,
    }
  }
  const c = await coreSwap(connection, coin, 'sell', toAtomic(amount, base.decimals), leg, owner)
  const jq = await jupQuote(coin.quoteMint, WSOL_MINT.toBase58(), c.minOutRaw, leg)
  const j = await jupInstructions(connection, jq, owner)
  return {
    tx: new Transaction().add(...c.ixs, ...j.ixs),
    luts: j.luts,
    out: fromAtomic(new BN(jq.outAmount), 9),
    minOut: fromAtomic(new BN(jq.otherAmountThreshold), 9),
    priceImpact: c.priceImpact != null ? c.priceImpact + Number(jq.priceImpactPct ?? 0) * 100 : null,
    route: `${c.route}, then pair asset to SOL via Jupiter`,
    via,
  }
}

/* ------------------------------------------------- graduation + fees */

export async function buildMigrate(connection: Connection, coin: Coin, payer: PublicKey) {
  const { dbc } = sdk(connection)
  const p = await dbc.state.getPool(coin.pool)
  if (!p) throw new Error('Pool not found')
  const c = await dbc.state.getPoolConfig(p.poolState.config)
  if (!c || !c.feeClaimer.equals(PLATFORM_WALLET) || p.poolState.isMigrated || p.poolState.quoteReserve.lt(c.migrationQuoteThreshold))
    throw new Error('This market is not ready to migrate.')
  const m = await dbc.migration.migrateToDammV2({ payer, pool: new PublicKey(coin.pool), dammConfig: DAMM_V2_MIGRATION_FEE_ADDRESS[c.migrationFeeOption] })
  return { tx: m.transaction, signers: [m.firstPositionNftKeypair, m.secondPositionNftKeypair] }
}

/** Creator claims as creator; the platform wallet claims as partner. */
export async function buildClaimFees(connection: Connection, coin: Coin, owner: PublicKey) {
  const { dbc } = sdk(connection)
  const pool = new PublicKey(coin.pool)
  if (owner.equals(PLATFORM_WALLET))
    return dbc.partner.claimPartnerTradingFeeToReceiver({ feeClaimer: owner, payer: owner, pool, maxBaseAmount: U64_MAX, maxQuoteAmount: U64_MAX, receiver: owner })
  if (coin.creator !== owner.toBase58()) throw new Error('Only the creator or the platform wallet can claim these fees.')
  return dbc.creator.claimCreatorTradingFeeToReceiver({ creator: owner, payer: owner, pool, maxBaseAmount: U64_MAX, maxQuoteAmount: U64_MAX, receiver: owner })
}

/** Locked-LP fee claims on the graduated DAMM v2 pool (creator + platform each hold a position). */
export async function buildClaimLpFees(connection: Connection, coin: Coin, owner: PublicKey) {
  const { amm } = sdk(connection)
  if (!coin.migrated) throw new Error('Not graduated yet.')
  const pool = new PublicKey(coin.tradingPool)
  const state = await amm.fetchPoolState(pool)
  const positions = await amm.getUserPositionByPool(pool, owner)
  if (!positions.length) throw new Error('This wallet has no LP position in the graduated pool.')
  const a = await mintInfo(connection, state.tokenAMint)
  const b = await mintInfo(connection, state.tokenBMint)
  return Promise.all(
    positions.map((p) =>
      amm.claimPositionFee2({
        owner,
        position: p.position,
        positionNftAccount: p.positionNftAccount,
        pool,
        tokenAMint: state.tokenAMint,
        tokenBMint: state.tokenBMint,
        tokenAVault: state.tokenAVault,
        tokenBVault: state.tokenBVault,
        tokenAProgram: a.program,
        tokenBProgram: b.program,
        receiver: owner,
      }),
    ),
  )
}

/* ---------------------------------------------------------- balances */

export async function tokenBalance(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<number> {
  try {
    const m = await mintInfo(connection, mint)
    const ata = getAssociatedTokenAddressSync(mint, owner, true, m.program)
    const bal = await connection.getTokenAccountBalance(ata)
    return Number(bal.value.uiAmountString ?? 0)
  } catch {
    return 0
  }
}

/** Spendable balance of a quote asset: native SOL (minus a small fee reserve) or the token balance. */
export async function quoteBalance(connection: Connection, owner: PublicKey, quoteMint: string) {
  if (quoteMint === WSOL_MINT.toBase58()) {
    const lamports = await connection.getBalance(owner).catch(() => 0)
    return Math.max(0, lamports / 1e9 - 0.01)
  }
  return tokenBalance(connection, owner, new PublicKey(quoteMint))
}

/* ------------------------------------------------------------ submit */

export type SignTx = <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>

/**
 * Mainnet check → compute budget → partial-sign extra signers → size check → simulate →
 * wallet signs (contents verified unchanged) → send → poll for confirmation.
 */
/**
 * Builds the exact transaction the wallet will sign. Launches (extra signers, near the 1232-byte limit)
 * carry no compute-budget instructions: they fit the default compute limit. Migration keeps a raised limit.
 */
export function compileForWallet(tx: Transaction, payer: PublicKey, blockhash: string, signers: Keypair[], budget: 'swap' | 'route' | 'launch' | 'migrate', luts: AddressLookupTableAccount[] = []) {
  const ixs = tx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId))
  if (budget === 'swap') ixs.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }))
  if (budget === 'route') ixs.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 900_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }))
  if (budget === 'migrate') ixs.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }))
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts)
  const vtx = new VersionedTransaction(msg)
  if (signers.length) vtx.sign(signers)
  return vtx
}

export async function submit(
  connection: Connection,
  owner: PublicKey,
  signTransaction: SignTx,
  tx: Transaction,
  signers: Keypair[],
  onStatus: (s: string) => void,
  budget: 'swap' | 'route' | 'launch' | 'migrate' = signers.length ? 'launch' : 'swap',
  luts: AddressLookupTableAccount[] = [],
) {
  await assertMainnet(connection)
  const [latest, lamports] = await Promise.all([connection.getLatestBlockhash('confirmed'), connection.getBalance(owner, 'confirmed')])
  if (lamports < 10_000) throw new UserError('Your wallet has no SOL to pay the network fee. Add at least 0.01 SOL and try again.')
  let vtx: VersionedTransaction
  try {
    vtx = compileForWallet(tx, owner, latest.blockhash, signers, budget, luts)
    if (vtx.serialize().length > 1232) throw new Error('too large')
  } catch {
    throw new UserError(budget === 'launch' ? 'This launch is too large for one Solana transaction. Use a shorter name or ticker.' : budget === 'route' ? 'This SOL route is too complex for one transaction. Try a different amount, or pay with the pair asset.' : 'This transaction is too large to send. Try a smaller amount.')
  }

  onStatus('Checking the transaction…')
  const sim = await connection.simulateTransaction(vtx, { sigVerify: false, commitment: 'confirmed', replaceRecentBlockhash: false })
  if (sim.value.err) throw new UserError(explainSimulation(sim.value.err, sim.value.logs ?? [], lamports))

  onStatus('Approve in your wallet…')
  const signed = await signTransaction(vtx)
  if (!Buffer.from(signed.message.serialize()).equals(Buffer.from(vtx.message.serialize()))) throw new UserError('Your wallet changed the transaction, so it wasn’t sent.')
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 3 })

  onStatus('Confirming…')
  for (let i = 0; i < 60; i++) {
    const st = (await connection.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]
    if (st?.err) throw new UserError('The transaction failed on-chain after it was sent. The network fee was charged; nothing else moved. Check it on Solscan and try again.')
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return sig
    if ((await connection.getBlockHeight('confirmed')) > latest.lastValidBlockHeight) throw new UserError('The network took too long and the transaction expired. Nothing was charged. Try again.')
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new UserError('Still waiting for the network to confirm. Check your wallet history before trying again.')
}

export type SignAll = <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>

/**
 * Many independent transactions (e.g. fee claims across markets): simulate each, sign all in one
 * wallet prompt, then send and confirm one by one. Reports each result instead of stopping at the first failure.
 */
export async function submitMany(
  connection: Connection,
  owner: PublicKey,
  signAllTransactions: SignAll,
  items: { label: string; tx: Transaction }[],
  onStatus: (s: string) => void,
) {
  await assertMainnet(connection)
  const lamports = await connection.getBalance(owner, 'confirmed')
  if (lamports < 10_000 * items.length) throw new UserError(`This wallet needs SOL for network fees: about ${(0.00001 * items.length + 0.003).toFixed(4)} SOL for ${items.length} claims. It has ${(lamports / 1e9).toPrecision(2)} SOL.`)
  const latest = await connection.getLatestBlockhash('confirmed')
  const ready: { label: string; vtx: VersionedTransaction }[] = []
  const results: { label: string; ok: boolean; detail: string; sig?: string }[] = []
  for (const [i, it] of items.entries()) {
    onStatus(`Checking ${i + 1} of ${items.length}…`)
    const vtx = compileForWallet(it.tx, owner, latest.blockhash, [], 'swap')
    const sim = await connection.simulateTransaction(vtx, { sigVerify: false, commitment: 'confirmed' })
    if (sim.value.err) results.push({ label: it.label, ok: false, detail: explainSimulation(sim.value.err, sim.value.logs ?? [], lamports) })
    else ready.push({ label: it.label, vtx })
  }
  if (!ready.length) return results
  onStatus(`Approve ${ready.length} transaction${ready.length > 1 ? 's' : ''} in your wallet…`)
  const signed = await signAllTransactions(ready.map((r) => r.vtx))
  for (const [i, tx] of signed.entries()) {
    onStatus(`Sending ${i + 1} of ${signed.length}…`)
    try {
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 })
      let done = false
      for (let k = 0; k < 40 && !done; k++) {
        const st = (await connection.getSignatureStatuses([sig])).value[0]
        if (st?.err) throw new Error('failed on-chain')
        done = st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized'
        if (!done) await new Promise((r) => setTimeout(r, 1500))
      }
      results.push({ label: ready[i].label, ok: done, detail: done ? 'Claimed' : 'Still confirming, check Solscan', sig })
    } catch (e: any) {
      results.push({ label: ready[i].label, ok: false, detail: e?.message === 'failed on-chain' ? 'Failed on-chain' : 'Couldn’t send, try again' })
    }
  }
  return results
}
