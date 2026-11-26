/**
 * Flip on-chain logic, built on pump.fun:
 *
 *  - every launch is a pump.fun `create_v2` coin (Token-2022, fixed 1B supply, mint authority revoked),
 *    quoted in SOL, USDC or a pump-listed tokenized stock.
 *  - trading runs on the pump.fun bonding curve (v3 trades). When the curve completes, pump.fun migrates
 *    the liquidity to its PumpSwap AMM; after that, trades route through Jupiter (which routes PumpSwap).
 *  - any coin can be traded with SOL: for non-SOL pairs the SOL leg goes through Jupiter in the same transaction.
 *  - markets shown on Flip are the coins launched from Flip, kept in a small registry (api/coins.ts).
 *
 * Field names ending in "Svx" hold amounts in the coin's pair asset (kept for compatibility).
 */
import BN from 'bn.js'
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type ParsedAccountData,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js'
import {
  AccountState,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getDefaultAccountState,
  getExtensionTypes,
  getPausableConfig,
  getTransferHook,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from '@solana/spl-token'
import {
  bondingCurvePda,
  canonicalPumpPoolPda,
  canonicalPumpPoolPdaWithQuote,
  getBuyTokenAmountFromSolAmount,
  getBuyV3TokenAmountFromQuoteAmount,
  getSellSolAmountFromTokenAmount,
  OnlinePumpSdk,
  PUMP_AMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
  type BondingCurve,
} from '@pump-fun/pump-sdk'
import { PUMP_AMM_SDK } from '@pump-fun/pump-sdk/swap'
import { FINAL_STRETCH_AT, MAINNET_GENESIS, WSOL_MINT } from './config'
import { fromAtomic, toAtomic, validateLaunch } from './validation'
import { explainSimulation, UserError } from './errors'

export { PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID }

export type CoinStatus = 'new' | 'final' | 'graduated'

export interface Coin {
  quoteMint: string
  /** the pump.fun bonding curve account */
  pool: string
  config: string
  /** where trades happen now: the curve, or the PumpSwap pool after migration */
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
  /** curve complete (trading on the curve stopped) */
  complete: boolean
  /** liquidity moved to PumpSwap */
  migrated: boolean
  status: CoinStatus
  /** creator fees waiting on the curve (not yet swept to the creator vault) */
  creatorFeeSvx: number
  partnerFeeSvx: number
  hidden?: boolean
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
/** SOL, USDC and the xStocks tokenized-stock catalogue. */
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

const TOKEN_DECIMALS = 6
const WSOL = WSOL_MINT.toBase58()
const isSol = (mint: string | PublicKey) => {
  const k = typeof mint === 'string' ? mint : mint.toBase58()
  return k === WSOL || k === PublicKey.default.toBase58()
}
/** pump.fun reports SOL curves with the zero key or the native mint; Flip uses the WSOL mint everywhere. */
const normQuote = (k: PublicKey) => (isSol(k) ? WSOL : k.toBase58())

const online = new WeakMap<Connection, OnlinePumpSdk>()
function pump(connection: Connection) {
  let s = online.get(connection)
  if (!s) online.set(connection, (s = new OnlinePumpSdk(connection)))
  return s
}

/** Global + fee config change rarely; cache them for a minute. */
let _globals: { at: number; p: Promise<[Awaited<ReturnType<OnlinePumpSdk['fetchGlobal']>>, Awaited<ReturnType<OnlinePumpSdk['fetchFeeConfig']>>]> } | null = null
function globals(connection: Connection) {
  if (!_globals || Date.now() - _globals.at > 60000) {
    const p = Promise.all([pump(connection).fetchGlobal(), pump(connection).fetchFeeConfig()])
    _globals = { at: Date.now(), p }
    p.catch(() => (_globals = null))
  }
  return _globals.p
}

/* ------------------------------------------------------------- mints */

const mintCache = new Map<string, Promise<{ decimals: number; program: PublicKey; supply: bigint }>>()
export function mintInfo(connection: Connection, mint: PublicKey) {
  const key = mint.toBase58()
  if (key === WSOL) return Promise.resolve({ decimals: 9, program: TOKEN_PROGRAM_ID, supply: 0n })
  if (!mintCache.has(key)) {
    const p = (async () => {
      const acc = await connection.getAccountInfo(mint)
      if (!acc || (!acc.owner.equals(TOKEN_PROGRAM_ID) && !acc.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Not a Solana token mint')
      const info = unpackMint(mint, acc, acc.owner)
      const hook = getTransferHook(info)
      if (getExtensionTypes(info.tlvData).includes(ExtensionType.NonTransferable) || getPausableConfig(info)?.paused || getDefaultAccountState(info)?.state === AccountState.Frozen)
        throw new Error('This token is paused, frozen by default or non-transferable')
      if (hook && !hook.programId.equals(PublicKey.default)) throw new Error('Tokens with transfer hooks are not supported')
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

/* -------------------------------------------------------- USD prices */

const usdCache = new Map<string, { at: number; p: Promise<number | null> }>()
/** USD price of a pair asset (GeckoTerminal, Jupiter fallback), cached 60s. */
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

/* ------------------------------------------------------------- pairs */

let _pairs: { at: number; p: Promise<Set<string>> } | null = null
/**
 * Pair assets pump.fun accepts for new coins right now: SOL, the mints pump.fun whitelists (USDC)
 * and the tokenized stocks on its quote-control list. Read from chain, cached 5 minutes.
 */
export function fetchPairMints(connection: Connection): Promise<Set<string>> {
  if (!_pairs || Date.now() - _pairs.at > 300000) {
    const p = pump(connection)
      .fetchSupportedQuoteMints()
      .then((list) => new Set(list.map((m) => normQuote(m.mint))))
    _pairs = { at: Date.now(), p }
    p.catch(() => (_pairs = null))
  }
  return _pairs.p
}

/* --------------------------------------------------------- metadata */

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

/** Name / symbol / uri from the Token-2022 metadata extension (pump.fun create_v2 coins). */
function parsedMeta(data: ParsedAccountData | Buffer | undefined) {
  const info = (data as ParsedAccountData | undefined)?.parsed?.info
  const ext = info?.extensions?.find((e: any) => e.extension === 'tokenMetadata')?.state
  return ext ? { name: String(ext.name ?? ''), symbol: String(ext.symbol ?? ''), uri: String(ext.uri ?? '') } : null
}

/* ------------------------------------------------------------- registry */

export interface Listing {
  mint: string
  creator: string
  quoteMint: string
  createdAt: number
  hidden?: boolean
}

let _reg: { at: number; all: boolean; p: Promise<Listing[]> } | null = null
/** Coins launched on Flip. Hidden ones only for the admin view. */
export function fetchListings(includeHidden = false): Promise<Listing[]> {
  if (!_reg || Date.now() - _reg.at > 15000 || _reg.all !== includeHidden) {
    const p = fetch(`/api/coins${includeHidden ? '?all=1' : ''}`, { signal: AbortSignal.timeout(15000) })
      .then((r) => r.json())
      .then((j) => (Array.isArray(j.coins) ? (j.coins as Listing[]) : []))
    _reg = { at: Date.now(), all: includeHidden, p }
    p.catch(() => (_reg = null))
  }
  return _reg.p
}

/** Adds a freshly launched coin to Flip's list. The server checks it on-chain first. */
export async function registerCoin(mint: string, signature: string) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch('/api/coins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mint, signature }) }).catch(() => null)
    if (r?.ok) {
      _reg = null
      return true
    }
    if (r && r.status < 500 && r.status !== 404 && r.status !== 409) return false
    await new Promise((res) => setTimeout(res, 2000))
  }
  return false
}

/* ------------------------------------------------------------- coins */

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

async function multiple(connection: Connection, keys: PublicKey[]) {
  const out = []
  for (const part of chunk(keys, 100)) out.push(...(await connection.getMultipleAccountsInfo(part)))
  return out
}

/** Live state for a list of Flip coins, straight from the pump.fun curves (and PumpSwap pools once graduated). */
async function loadCoins(connection: Connection, list: Listing[]): Promise<Coin[]> {
  if (!list.length) return []
  const mints = list.map((l) => new PublicKey(l.mint))
  const curveKeys = mints.map((m) => bondingCurvePda(m))
  const [curveInfos, mintInfos] = await Promise.all([
    multiple(connection, curveKeys),
    (async () => {
      const out = []
      for (const part of chunk(mints, 100)) out.push(...(await connection.getMultipleParsedAccounts(part)).value)
      return out
    })(),
  ])

  const curves: (BondingCurve | null)[] = curveInfos.map((info) => {
    try {
      return info && info.owner.equals(PUMP_PROGRAM_ID) ? PUMP_SDK.decodeBondingCurveNullable(info) : null
    } catch {
      return null
    }
  })

  // graduated coins: read their PumpSwap pool for the live price
  const gradIdx = curves.map((c, i) => (c?.complete ? i : -1)).filter((i) => i >= 0)
  const poolKeys = gradIdx.map((i) => (isSol(curves[i]!.quoteMint) ? canonicalPumpPoolPda(mints[i]) : canonicalPumpPoolPdaWithQuote(mints[i], curves[i]!.quoteMint)))
  const poolInfos = poolKeys.length ? await multiple(connection, poolKeys) : []
  const pools = new Map<number, { key: PublicKey; base: PublicKey; quote: PublicKey }>()
  poolInfos.forEach((info, j) => {
    if (!info || !info.owner.equals(PUMP_AMM_PROGRAM_ID)) return
    try {
      const p = PUMP_AMM_SDK.decodePool(info)
      pools.set(gradIdx[j], { key: poolKeys[j], base: p.poolBaseTokenAccount, quote: p.poolQuoteTokenAccount })
    } catch {
      /* not decodable: treat as not migrated yet */
    }
  })
  const vaultKeys = [...pools.values()].flatMap((p) => [p.base, p.quote])
  const vaults = vaultKeys.length ? (await connection.getMultipleParsedAccounts(vaultKeys)).value : []
  const vaultAmt = new Map<string, number>()
  vaults.forEach((v, i) => {
    const amt = (v?.data as ParsedAccountData | undefined)?.parsed?.info?.tokenAmount?.uiAmount
    if (typeof amt === 'number') vaultAmt.set(vaultKeys[i].toBase58(), amt)
  })

  const coins: Coin[] = []
  await Promise.all(
    list.map(async (l, i) => {
      const c = curves[i]
      if (!c) return
      const quoteMint = normQuote(c.quoteMint)
      const qd = (await mintInfo(connection, new PublicKey(quoteMint)).catch(() => null))?.decimals
      if (qd === undefined) return
      const meta = parsedMeta(mintInfos[i]?.data as any)
      const supply = fromAtomic(c.tokenTotalSupply, TOKEN_DECIMALS) || 1_000_000_000
      const vT = fromAtomic(c.virtualTokenReserves, TOKEN_DECIMALS)
      const vQ = fromAtomic(c.virtualQuoteReserves, qd)
      const realT = fromAtomic(c.realTokenReserves, TOKEN_DECIMALS)
      const reserve = fromAtomic(c.realQuoteReserves, qd)
      let price = vT > 0 ? vQ / vT : 0
      // constant product: quote that must be in the curve when the last sellable token is bought
      const endT = vT - realT
      const threshold = endT > 0 ? reserve + (vT * vQ) / endT - vQ : reserve
      const pool = pools.get(i)
      let migrated = false
      let tradingPool = curveKeys[i].toBase58()
      if (pool) {
        migrated = true
        tradingPool = pool.key.toBase58()
        const b = vaultAmt.get(pool.base.toBase58())
        const q = vaultAmt.get(pool.quote.toBase58())
        if (b && q) price = q / b
      }
      const progress = c.complete ? 1 : threshold > 0 ? Math.min(1, reserve / threshold) : 0
      coins.push({
        quoteMint,
        pool: curveKeys[i].toBase58(),
        config: '',
        tradingPool,
        mint: l.mint,
        creator: c.creator.toBase58(),
        name: meta?.name || 'Unnamed',
        symbol: meta?.symbol || '???',
        uri: meta?.uri || '',
        priceSvx: price,
        mcapSvx: price * supply,
        reserveSvx: c.complete ? threshold : reserve,
        thresholdSvx: threshold,
        progress,
        createdAt: l.createdAt,
        complete: c.complete,
        migrated,
        status: c.complete ? 'graduated' : progress >= FINAL_STRETCH_AT ? 'final' : 'new',
        creatorFeeSvx: fromAtomic(c.creatorFee ?? new BN(0), qd),
        partnerFeeSvx: 0,
        hidden: l.hidden,
      })
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
  return coins.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

/** Every market launched on Flip. `includeUnlisted` also returns coins the admin hid. */
export async function fetchCoins(connection: Connection, opts: { includeUnlisted?: boolean } = {}): Promise<Coin[]> {
  const list = await fetchListings(!!opts.includeUnlisted)
  return loadCoins(connection, opts.includeUnlisted ? list : list.filter((l) => !l.hidden))
}

export async function fetchCoin(connection: Connection, mintOrCurve: string): Promise<Coin | null> {
  const list = await fetchListings().catch(() => [] as Listing[])
  const hit = list.find((l) => l.mint === mintOrCurve) ?? list.find((l) => { try { return bondingCurvePda(new PublicKey(l.mint)).toBase58() === mintOrCurve } catch { return false } })
  if (!hit || hit.hidden) return null
  return (await loadCoins(connection, [hit]))[0] ?? null
}

export async function fetchCoinsByCreator(connection: Connection, creator: PublicKey): Promise<Coin[]> {
  const list = (await fetchListings()).filter((l) => l.creator === creator.toBase58() && !l.hidden)
  return loadCoins(connection, list)
}

/* ------------------------------------------------------------ trades */

export interface Trade {
  sig: string
  time: number
  side: 'buy' | 'sell'
  trader: string
  tokens: number
  svx: number
  price: number
}

/** Recent trades (curve, or PumpSwap once migrated), rebuilt from the trader's balance changes. Newest first. */
export async function fetchTrades(connection: Connection, coin: Coin, limit = 20): Promise<Trade[]> {
  const sigs = (await connection.getSignaturesForAddress(new PublicKey(coin.tradingPool), { limit })).filter((s) => !s.err)
  const txs: (ParsedTransactionWithMeta | null)[] = []
  for (const part of chunk(sigs, 10)) {
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
    // SOL curves move lamports directly, so read the trader's SOL balance instead
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
  /** first buy in the pair asset, made in the launch transaction (optional) */
  firstBuy?: string
}

/** One transaction: pump.fun create_v2 (+ the creator's first buy, paid in the pair asset). */
export async function buildLaunch(connection: Connection, creator: PublicKey, p: LaunchParams) {
  validateLaunch(p.name, p.symbol)
  if (p.uri.length > 200) throw new Error('Metadata link is too long.')
  const sol = isSol(p.quoteMint)
  const supported = await fetchPairMints(connection)
  if (!supported.has(p.quoteMint)) throw new UserError('pump.fun doesn’t accept this pair asset for new coins right now. Choose another pair.')
  const sdk = pump(connection)
  const mint = Keypair.generate()
  const base = { mint: mint.publicKey, name: p.name.trim(), symbol: p.symbol, uri: p.uri, creator, user: creator, mayhemMode: false }
  const quote = sol ? null : await sdk.resolveQuoteMint(new PublicKey(p.quoteMint))
  const q = quote ? { quoteMint: quote.mint, quoteTokenProgram: quote.quoteTokenProgram } : {}
  const buy = Number(p.firstBuy || 0)

  let ixs: TransactionInstruction[]
  if (buy > 0) {
    const [global, feeConfig] = await globals(connection)
    const quoteControl = quote ? await sdk.fetchQuoteControl() : null
    const quoteAmount = toAtomic(p.firstBuy!, quote ? quote.decimals : 9)
    const quoteTransferFee = quote ? await sdk.fetchQuoteTransferFee(quote.mint) : null
    const amount = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: null,
      bondingCurve: null,
      amount: quoteAmount,
      quoteMint: quote?.mint,
      quoteControl,
      quoteTransferFee,
    } as any)
    ixs = await PUMP_SDK.createV2AndBuyV2Instructions({ global, ...base, ...q, amount, quoteAmount, slippage: 5 })
  } else {
    ixs = [await PUMP_SDK.createV2Instruction({ ...base, ...q })]
  }
  return { tx: new Transaction().add(...ixs), signers: [mint], pool: bondingCurvePda(mint.publicKey).toBase58(), mint: mint.publicKey.toBase58() }
}

/* -------------------------------------------------------------- swap */

export interface Prepared {
  tx: Transaction
  /** address lookup tables needed to fit routed (Jupiter) trades */
  luts: AddressLookupTableAccount[]
  out: number
  minOut: number
  priceImpact: number | null
  route: string
  /** what the user pays with / receives: the pair asset, or SOL routed through Jupiter */
  via: 'pair' | 'sol'
  /** compute budget to use when sending */
  budget: Budget
}

type Core = { ixs: TransactionInstruction[]; outRaw: BN; minOutRaw: BN; priceImpact: number | null; route: string }

const applySlip = (v: BN, bps: number) => v.muln(10_000 - bps).divn(10_000)

/** One pump.fun bonding-curve trade with an exact raw input (pair asset for buys, coin for sells). */
async function curveSwap(connection: Connection, coin: Coin, side: 'buy' | 'sell', amountIn: BN, slippageBps: number, owner: PublicKey): Promise<Core> {
  const sdk = pump(connection)
  const mint = new PublicKey(coin.mint)
  const tokenProgram = (await mintInfo(connection, mint)).program
  const hint = isSol(coin.quoteMint) ? undefined : new PublicKey(coin.quoteMint)
  const [global, feeConfig] = await globals(connection)
  const qd = (await mintInfo(connection, new PublicKey(coin.quoteMint))).decimals
  const slippage = slippageBps / 100

  if (side === 'buy') {
    const st = await sdk.fetchBuyState(mint, owner, tokenProgram, hint)
    if (st.bondingCurve.complete) throw new UserError('This curve just completed and is moving to PumpSwap. Trading resumes here in a minute.')
    const out = getBuyV3TokenAmountFromQuoteAmount({ global, feeConfig, mintSupply: st.bondingCurve.tokenTotalSupply, bondingCurve: st.bondingCurve, amount: amountIn, curveBaseTokenBalance: st.curveBaseTokenBalance, quoteTransferFee: st.quoteTransferFee } as any)
    if (out.isZero()) throw new UserError('That amount is too small to trade. Enter a bigger amount.')
    const ixs = await PUMP_SDK.buyExactQuoteInV3Instructions({ bondingCurve: st.bondingCurve, associatedUserAccountInfo: st.associatedUserAccountInfo, mint, user: owner, amount: out, quoteAmount: amountIn, slippage, tokenProgram, quoteTokenProgram: st.quoteTokenProgram })
    const amt = fromAtomic(amountIn, qd)
    const got = fromAtomic(out, TOKEN_DECIMALS)
    const exec = got ? amt / got : 0
    return { ixs, outRaw: out, minOutRaw: applySlip(out, slippageBps), priceImpact: coin.priceSvx && exec ? Math.abs(exec / coin.priceSvx - 1) * 100 : null, route: 'pump.fun bonding curve' }
  }

  const st = await sdk.fetchSellState(mint, owner, tokenProgram, hint)
  if (st.bondingCurve.complete) throw new UserError('This curve just completed and is moving to PumpSwap. Trading resumes here in a minute.')
  const outQ = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: st.bondingCurve.tokenTotalSupply, bondingCurve: st.bondingCurve, amount: amountIn, quoteTransferFee: st.quoteTransferFee } as any)
  if (outQ.isZero()) throw new UserError('That amount is too small to trade. Enter a bigger amount.')
  const ixs = await PUMP_SDK.sellV3Instructions({ bondingCurve: st.bondingCurve, mint, user: owner, amount: amountIn, quoteAmount: outQ, slippage, tokenProgram, quoteTokenProgram: st.quoteTokenProgram })
  const amt = fromAtomic(amountIn, TOKEN_DECIMALS)
  const got = fromAtomic(outQ, qd)
  const exec = amt ? got / amt : 0
  return { ixs, outRaw: outQ, minOutRaw: applySlip(outQ, slippageBps), priceImpact: coin.priceSvx && exec ? Math.abs(exec / coin.priceSvx - 1) * 100 : null, route: 'pump.fun bonding curve' }
}

/* ---- Jupiter ---- */

async function jupQuote(inputMint: string, outputMint: string, amount: BN, slippageBps: number, maxAccounts = 20) {
  const r = await fetch(`/api/jup?op=quote&inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippageBps=${slippageBps}&maxAccounts=${maxAccounts}`, { signal: AbortSignal.timeout(15000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.outAmount) throw new UserError(`There’s no route for this trade right now${j?.error ? ` (${j.error})` : ''}. Try a different amount, or try again in a minute.`)
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
  if (!r.ok || !j.swapInstruction) throw new UserError('Couldn’t build the route right now. Try again in a moment.')
  const ixs: TransactionInstruction[] = [...(j.setupInstructions ?? []).map(toIx), toIx(j.swapInstruction), ...(j.cleanupInstruction ? [toIx(j.cleanupInstruction)] : [])]
  const luts = (await Promise.all((j.addressLookupTableAddresses ?? []).map((a: string) => connection.getAddressLookupTable(new PublicKey(a)).then((r) => r.value)))).filter(Boolean) as AddressLookupTableAccount[]
  return { ixs, luts }
}

/** Graduated coins trade on PumpSwap; Jupiter routes it directly (and through SOL for non-SOL pairs). */
async function jupiterOnly(connection: Connection, coin: Coin, side: 'buy' | 'sell', amount: string, slippageBps: number, owner: PublicKey, payMint: string) {
  const baseDec = TOKEN_DECIMALS
  const payDec = (await mintInfo(connection, new PublicKey(payMint))).decimals
  const [inMint, outMint, inDec, outDec] = side === 'buy' ? [payMint, coin.mint, payDec, baseDec] : [coin.mint, payMint, baseDec, payDec]
  let lastErr: unknown
  for (const maxAccounts of [40, 30, 20]) {
    try {
      const jq = await jupQuote(inMint, outMint, toAtomic(amount, inDec), slippageBps, maxAccounts)
      const j = await jupInstructions(connection, jq, owner)
      const tx = new Transaction().add(...j.ixs)
      if (compileForWallet(tx, owner, PublicKey.default.toBase58(), [], 'route', j.luts).serialize().length > 1232) {
        lastErr = new UserError('This route is too complex for one transaction. Try a different amount.')
        continue
      }
      return { tx, luts: j.luts, out: fromAtomic(new BN(jq.outAmount), outDec), minOut: fromAtomic(new BN(jq.otherAmountThreshold), outDec), priceImpact: Number(jq.priceImpactPct ?? 0) * 100, route: 'PumpSwap via Jupiter', budget: 'route' as Budget }
    } catch (e) {
      lastErr = e
      if (e instanceof UserError && /no route/i.test(e.message)) break
    }
  }
  if (coin.complete && !coin.migrated) throw new UserError('This coin just graduated and pump.fun is moving its liquidity to PumpSwap. Trading resumes here in a minute.')
  throw lastErr
}

/**
 * Builds a buy or sell. `via: 'sol'` lets anyone trade any market with SOL: for a coin paired with another asset,
 * buying routes SOL → pair asset (Jupiter) → coin (pump.fun curve) in one transaction, and selling the reverse.
 */
export async function prepareSwap(connection: Connection, coin: Coin, side: 'buy' | 'sell', amount: string, slippageBps: number, owner: PublicKey, via: 'pair' | 'sol' = 'pair'): Promise<Prepared> {
  if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 1000) throw new UserError('Slippage must be between 0.1% and 10%.')
  const pairIsSol = isSol(coin.quoteMint)
  const routed = via === 'sol' && !pairIsSol

  if (coin.complete) {
    const p = await jupiterOnly(connection, coin, side, amount, slippageBps, owner, routed || pairIsSol ? WSOL : coin.quoteMint)
    return { ...p, via }
  }

  const quote = await mintInfo(connection, new PublicKey(coin.quoteMint))
  if (!routed) {
    const sell = side === 'sell'
    const inDec = sell ? TOKEN_DECIMALS : quote.decimals
    const outDec = sell ? quote.decimals : TOKEN_DECIMALS
    const c = await curveSwap(connection, coin, side, toAtomic(amount, inDec), slippageBps, owner)
    return { tx: new Transaction().add(...c.ixs), luts: [], out: fromAtomic(c.outRaw, outDec), minOut: fromAtomic(c.minOutRaw, outDec), priceImpact: c.priceImpact, route: c.route, via, budget: pairIsSol ? 'swap' : 'swap22' }
  }

  // split slippage across the two legs so the total stays within what the user chose
  const leg = Math.max(10, Math.floor(slippageBps / 2))
  let lastErr: unknown
  for (const maxAccounts of [20, 14, 10]) {
    try {
      const p = await routed2(connection, coin, side, amount, leg, owner, maxAccounts, quote.decimals)
      const size = compileForWallet(p.tx, owner, PublicKey.default.toBase58(), [], 'route', p.luts).serialize().length
      if (size <= 1232) return { ...p, via, budget: 'route' }
      lastErr = new UserError('This SOL route is too complex for one transaction. Try a different amount, or pay with the pair asset.')
    } catch (e) {
      lastErr = e
      if (e instanceof UserError && /no route/i.test(e.message)) break
    }
  }
  throw lastErr
}

async function routed2(connection: Connection, coin: Coin, side: 'buy' | 'sell', amount: string, leg: number, owner: PublicKey, maxAccounts: number, quoteDecimals: number) {
  if (side === 'buy') {
    const jq = await jupQuote(WSOL, coin.quoteMint, toAtomic(amount, 9), leg, maxAccounts)
    const c = await curveSwap(connection, coin, 'buy', new BN(jq.otherAmountThreshold), leg, owner)
    const j = await jupInstructions(connection, jq, owner)
    return {
      tx: new Transaction().add(...j.ixs, ...c.ixs),
      luts: j.luts,
      out: fromAtomic(c.outRaw, TOKEN_DECIMALS),
      minOut: fromAtomic(c.minOutRaw, TOKEN_DECIMALS),
      priceImpact: c.priceImpact != null ? c.priceImpact + Number(jq.priceImpactPct ?? 0) * 100 : null,
      route: `SOL to pair asset via Jupiter, then the ${c.route}`,
    }
  }
  const c = await curveSwap(connection, coin, 'sell', toAtomic(amount, TOKEN_DECIMALS), leg, owner)
  const jq = await jupQuote(coin.quoteMint, WSOL, c.minOutRaw, leg, maxAccounts)
  const j = await jupInstructions(connection, jq, owner)
  void quoteDecimals
  return {
    tx: new Transaction().add(...c.ixs, ...j.ixs),
    luts: j.luts,
    out: fromAtomic(new BN(jq.outAmount), 9),
    minOut: fromAtomic(new BN(jq.otherAmountThreshold), 9),
    priceImpact: c.priceImpact != null ? c.priceImpact + Number(jq.priceImpactPct ?? 0) * 100 : null,
    route: `the ${c.route}, then pair asset to SOL via Jupiter`,
  }
}

/* ------------------------------------------------------- creator fees */

/** Creator fees already in the creator's pump.fun / PumpSwap vaults, per pair asset (all their coins). */
export async function creatorVault(connection: Connection, creator: PublicKey, quoteMint: string) {
  const extra = isSol(quoteMint) ? [] : [new PublicKey(quoteMint)]
  const rows = await pump(connection).getCreatorVaultQuoteBalances(creator, extra)
  const row = rows.find((r) => normQuote(r.mint) === quoteMint)
  if (!row) return 0
  return fromAtomic(row.total, (await mintInfo(connection, new PublicKey(quoteMint))).decimals)
}

/** Sweeps this coin's curve fees into the creator vault, then pays the vault out to the creator. */
export async function buildClaimFees(connection: Connection, coin: Coin, owner: PublicKey) {
  if (coin.creator !== owner.toBase58()) throw new UserError('Only the coin’s creator can claim its creator fees.')
  const sdk = pump(connection)
  const mint = new PublicKey(coin.mint)
  const sol = isSol(coin.quoteMint)
  const quoteMint = sol ? PublicKey.default : new PublicKey(coin.quoteMint)
  const quoteTokenProgram = sol ? TOKEN_PROGRAM_ID : (await mintInfo(connection, quoteMint)).program
  const ixs: TransactionInstruction[] = []
  if (coin.creatorFeeSvx > 0) ixs.push(await PUMP_SDK.sweepCreatorFeeInstruction({ payer: owner, mint, creator: owner, quoteMint, quoteTokenProgram }))
  ixs.push(...(sol ? await sdk.collectCoinCreatorFeeInstructions(owner, owner) : await sdk.collectCoinCreatorFeeV2Instructions(owner, quoteMint, quoteTokenProgram, owner)))
  return new Transaction().add(...ixs)
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

/** Spendable balance of a pair asset: native SOL (minus a small fee reserve) or the token balance. */
export async function quoteBalance(connection: Connection, owner: PublicKey, quoteMint: string) {
  if (isSol(quoteMint)) {
    const lamports = await connection.getBalance(owner).catch(() => 0)
    return Math.max(0, lamports / 1e9 - 0.01)
  }
  return tokenBalance(connection, owner, new PublicKey(quoteMint))
}

export { NATIVE_MINT }

/* ------------------------------------------------------------ submit */

export type SignTx = <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>
/** swap: SOL curve trade · swap22: Token-2022 pair trade · route: with a Jupiter leg · launch: create (+ first buy) */
export type Budget = 'swap' | 'swap22' | 'route' | 'launch' | 'claim'
const UNITS: Record<Budget, number> = { swap: 200_000, swap22: 320_000, route: 900_000, launch: 500_000, claim: 300_000 }

/** Builds the exact transaction the wallet will sign (compute budget, v0 message, extra signers). */
export function compileForWallet(tx: Transaction, payer: PublicKey, blockhash: string, signers: Keypair[], budget: Budget, luts: AddressLookupTableAccount[] = []) {
  const ixs = tx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId))
  ixs.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: UNITS[budget] }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }))
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts)
  const vtx = new VersionedTransaction(msg)
  if (signers.length) vtx.sign(signers)
  return vtx
}

/**
 * Mainnet check → compute budget → partial-sign extra signers → size check → simulate →
 * wallet signs (contents verified unchanged) → send → poll for confirmation.
 */
export async function submit(
  connection: Connection,
  owner: PublicKey,
  signTransaction: SignTx,
  tx: Transaction,
  signers: Keypair[],
  onStatus: (s: string) => void,
  budget: Budget = signers.length ? 'launch' : 'swap',
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
    throw new UserError(budget === 'launch' ? 'This launch is too large for one Solana transaction. Use a shorter name or ticker.' : budget === 'route' ? 'This route is too complex for one transaction. Try a different amount, or pay with the pair asset.' : 'This transaction is too large to send. Try a smaller amount.')
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
 * Many independent transactions: simulate each, sign all in one wallet prompt, then send and confirm one by one.
 * Reports each result instead of stopping at the first failure.
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
  if (lamports < 10_000 * items.length) throw new UserError(`This wallet needs SOL for network fees: about ${(0.00001 * items.length + 0.003).toFixed(4)} SOL for ${items.length} transactions. It has ${(lamports / 1e9).toPrecision(2)} SOL.`)
  const latest = await connection.getLatestBlockhash('confirmed')
  const ready: { label: string; vtx: VersionedTransaction }[] = []
  const results: { label: string; ok: boolean; detail: string; sig?: string }[] = []
  for (const [i, it] of items.entries()) {
    onStatus(`Checking ${i + 1} of ${items.length}…`)
    const vtx = compileForWallet(it.tx, owner, latest.blockhash, [], 'claim')
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
      results.push({ label: ready[i].label, ok: done, detail: done ? 'Done' : 'Still confirming, check Solscan', sig })
    } catch (e: any) {
      results.push({ label: ready[i].label, ok: false, detail: e?.message === 'failed on-chain' ? 'Failed on-chain' : 'Couldn’t send, try again' })
    }
  }
  return results
}

/** Live state for any pump.fun mints, whether or not they are listed on Flip (diagnostics). */
export function fetchCoinsByMints(connection: Connection, mints: string[]) {
  return loadCoins(connection, mints.map((mint) => ({ mint, creator: '', quoteMint: '', createdAt: 0 })))
}
