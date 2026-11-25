/**
 * Creates the Solvex Meteora DBC config: every coin launched on Solvex uses it.
 * The config fixes the curve shape, fees, quote currency ($SVX) and the
 * graduation (migration) threshold.
 *
 *   npm run create-config            -> builds + validates only (dry run)
 *   npm run create-config -- --send  -> sends the createConfig transaction
 *
 * Env (.env): VITE_RPC_URL, VITE_SVX_MINT, VITE_SVX_DECIMALS, PARTNER_KEYPAIR
 * Optional:   INITIAL_MCAP_SVX, MIGRATION_MCAP_SVX, TRADING_FEE_BPS, CREATOR_FEE_PCT, POOL_CREATION_FEE_SVX
 */
import 'dotenv/config'
import fs from 'node:fs'
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js'
import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithMarketCap,
  CollectFeeMode,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  validateConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk'

const SEND = process.argv.includes('--send')
const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d)

const RPC = process.env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com'
const SVX_DECIMALS = num('VITE_SVX_DECIMALS', 6)
const INITIAL_MCAP = num('INITIAL_MCAP_SVX', 30_000) // market cap (in SVX) at launch
const MIGRATION_MCAP = num('MIGRATION_MCAP_SVX', 400_000) // market cap (in SVX) at graduation
const TRADING_FEE_BPS = num('TRADING_FEE_BPS', 100) // 1% per trade
const CREATOR_FEE_PCT = num('CREATOR_FEE_PCT', 50) // creator's share of the trading fee
const POOL_CREATION_FEE = num('POOL_CREATION_FEE_SVX', 0) // optional fee (in SVX) to launch

const curve = buildCurveWithMarketCap({
  token: {
    tokenType: TokenType.SPLToken,
    tokenBaseDecimal: TokenDecimal.SIX,
    tokenQuoteDecimal: SVX_DECIMALS,
    tokenAuthorityOption: TokenAuthorityOption.Immutable,
    totalTokenSupply: 1_000_000_000,
    leftover: 0,
  },
  fee: {
    baseFeeParams: {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: { startingFeeBps: TRADING_FEE_BPS, endingFeeBps: TRADING_FEE_BPS, numberOfPeriod: 0, totalDuration: 0 },
    },
    dynamicFeeEnabled: true,
    collectFeeMode: CollectFeeMode.QuoteToken,
    creatorTradingFeePercentage: CREATOR_FEE_PCT,
    poolCreationFee: POOL_CREATION_FEE,
    enableFirstSwapWithMinFee: false,
  },
  migration: {
    migrationOption: MigrationOption.MET_DAMM_V2,
    migrationFeeOption: MigrationFeeOption.FixedBps100,
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
  },
  // 100% of graduated LP is permanently locked, split between partner (Solvex) and creator
  liquidityDistribution: {
    partnerPermanentLockedLiquidityPercentage: 50,
    partnerLiquidityPercentage: 0,
    creatorPermanentLockedLiquidityPercentage: 50,
    creatorLiquidityPercentage: 0,
  },
  lockedVesting: {
    totalLockedVestingAmount: 0,
    numberOfVestingPeriod: 0,
    cliffUnlockAmount: 0,
    totalVestingDuration: 0,
    cliffDurationFromMigrationTime: 0,
  },
  activationType: ActivationType.Timestamp,
  initialMarketCap: INITIAL_MCAP,
  migrationMarketCap: MIGRATION_MCAP,
})

const threshold = Number(curve.migrationQuoteThreshold.toString()) / 10 ** SVX_DECIMALS
console.log('Curve built')
console.log(`  launch mcap      ${INITIAL_MCAP.toLocaleString()} SVX`)
console.log(`  graduation mcap  ${MIGRATION_MCAP.toLocaleString()} SVX`)
console.log(`  graduates at     ${threshold.toLocaleString()} SVX in the curve`)
console.log(`  trading fee      ${TRADING_FEE_BPS / 100}% (creator gets ${CREATOR_FEE_PCT}% of it)`)

async function main() {
  validateConfigParameters({ ...curve, leftoverReceiver: Keypair.generate().publicKey } as any)
  console.log('  validation       passed')
  if (!SEND) {
    console.log('\nDry run only. Re-run with  npm run create-config -- --send  to create it on-chain.')
    return
  }
  const svxMint = process.env.VITE_SVX_MINT
  if (!svxMint) throw new Error('Set VITE_SVX_MINT in .env')
  const kpPath = process.env.PARTNER_KEYPAIR || './partner-keypair.json'
  const partner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, 'utf8'))))
  const configKp = Keypair.generate()

  const connection = new Connection(RPC, 'confirmed')
  const client = new DynamicBondingCurveClient(connection, 'confirmed')
  const tx = await client.partner.createConfig({
    ...curve,
    config: configKp.publicKey,
    feeClaimer: partner.publicKey,
    leftoverReceiver: partner.publicKey,
    quoteMint: new PublicKey(svxMint),
    payer: partner.publicKey,
  })
  const sig = await sendAndConfirmTransaction(connection, tx, [partner, configKp], { commitment: 'confirmed' })
  console.log('\nConfig created:', configKp.publicKey.toBase58())
  console.log('Tx:', sig)
  console.log(`\nAdd to .env ->  VITE_DBC_CONFIG=${configKp.publicKey.toBase58()}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
