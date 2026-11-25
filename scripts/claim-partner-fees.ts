/**
 * Claims the Solvex (partner) share of trading fees from every pool on the config.
 *   npm run claim-partner-fees
 */
import 'dotenv/config'
import fs from 'node:fs'
import BN from 'bn.js'
import { Connection, Keypair, sendAndConfirmTransaction } from '@solana/web3.js'
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk'

async function main() {
  const connection = new Connection(process.env.VITE_RPC_URL!, 'confirmed')
  const client = new DynamicBondingCurveClient(connection, 'confirmed')
  const partner = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.PARTNER_KEYPAIR || './partner-keypair.json', 'utf8'))),
  )
  const pools = await client.state.getPoolsByConfig(process.env.VITE_DBC_CONFIG!)
  for (const { publicKey, account } of pools) {
    const q = new BN(account.poolState.partnerQuoteFee.toString())
    const b = new BN(account.poolState.partnerBaseFee.toString())
    if (q.isZero() && b.isZero()) continue
    const tx = await client.partner.claimPartnerTradingFee({
      pool: publicKey,
      feeClaimer: partner.publicKey,
      payer: partner.publicKey,
      maxBaseAmount: b,
      maxQuoteAmount: q,
    })
    const sig = await sendAndConfirmTransaction(connection, tx, [partner])
    console.log(`claimed ${publicKey.toBase58()}  ${sig}`)
  }
  console.log('done')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
