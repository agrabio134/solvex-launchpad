/**
 * Turns wallet, RPC, simulation and on-chain failures into plain sentences:
 * what happened, and what to do about it. Nothing here is shown as raw program output.
 */

/** An error whose message is already written for the user. */
export class UserError extends Error {}

const sol = (lamports: number) => {
  const v = lamports / 1e9
  if (v === 0) return '0'
  return v >= 0.01 ? v.toFixed(3) : v.toPrecision(2)
}

/** Meteora DBC / DAMM v2 program errors that users can actually hit, in plain words. */
const PROGRAM: Record<string, string> = {
  exceededSlippage: 'The price moved past your slippage limit before the trade landed. Nothing was spent. Try again, or allow a little more slippage.',
  poolIsCompleted: 'This curve just filled up, so trading on it has stopped. Migrate it to Solana from the coin page to keep trading.',
  notEnoughLiquidity: 'There isn’t enough liquidity for a trade this size. Try a smaller amount.',
  insufficientLiquidity: 'There isn’t enough liquidity for a trade this size. Try a smaller amount.',
  insufficientLiquidityForMigration: 'This curve doesn’t hold enough liquidity to migrate yet.',
  poolIsIncompleted: 'This curve isn’t full yet, so it can’t be migrated.',
  amountIsZero: 'That amount is too small to trade. Enter a bigger amount.',
  exceededInputAmount: 'That amount is more than this curve can take before it fills. Try a smaller amount.',
  poolDisabled: 'Trading on this pool is paused.',
  notPermitToDoThisAction: 'This wallet isn’t allowed to do that on this market.',
  unauthorized: 'This wallet isn’t allowed to do that on this market.',
  invalidFeeClaimer: 'Only the platform wallet can claim the platform’s fees.',
  invalidOwnerAccount: 'Only the coin’s creator can claim these fees.',
  incorrectAta: 'A token account in this transaction doesn’t match your wallet. Refresh the page and try again.',
  invalidQuoteMint: 'That pair asset isn’t supported for launches.',
  quoteMintHasNonZeroTransferFee: 'That pair asset charges a transfer fee, which launches don’t support.',
  invalidTokenBadge: 'That pair asset needs a Meteora token badge before it can be used.',
  mathOverflow: 'That amount is too large to process. Try a smaller amount.',
}
const DBC = ['mathOverflow', 'invalidFee', 'exceededSlippage', 'exceedMaxFeeBps', 'invalidAdmin', 'amountIsZero', 'typeCastFailed', 'invalidActivationType', 'invalidQuoteMint', 'invalidCollectFeeMode', 'invalidMigrationFeeOption', 'invalidInput', 'notEnoughLiquidity', 'poolIsCompleted', 'poolIsIncompleted', 'invalidMigrationOption', 'invalidTokenDecimals', 'invalidTokenType', 'invalidFeePercentage', 'invalidQuoteThreshold', 'invalidTokenSupply', 'invalidCurve', 'notPermitToDoThisAction', 'invalidOwnerAccount', 'invalidConfigAccount', 'surplusHasBeenWithdraw', 'leftoverHasBeenWithdraw', 'totalBaseTokenExceedMaxSupply', 'unsupportNativeMintToken2022', 'insufficientLiquidityForMigration', 'missingPoolConfigInRemainingAccount', 'invalidVestingParameters', 'invalidLeftoverAddress', 'insufficientLiquidity']
const DBC_TAIL: Record<number, string> = { 6053: 'unauthorized', 6058: 'incorrectAta', 6080: 'invalidTokenBadge', 6081: 'quoteMintHasNonZeroTransferFee', 6085: 'exceededInputAmount', 6086: 'invalidFeeClaimer' }
const AMM: Record<number, string> = { 6000: 'mathOverflow', 6002: 'exceededSlippage', 6003: 'poolDisabled', 6006: 'amountIsZero', 6023: 'insufficientLiquidity', 6060: 'incorrectAta' }
const DBC_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'
const AMM_ID = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'

const human = (name: string) => name.replace(/([A-Z])/g, ' $1').toLowerCase()

/** Reads a failed simulation (error + logs) and says what went wrong in plain words. */
export function explainSimulation(err: unknown, logs: string[], walletLamports: number): string {
  const text = logs.join('\n')
  const e = JSON.stringify(err ?? '')

  // SOL for fees / rent
  const lam = /insufficient lamports (\d+), need (\d+)/.exec(text)
  if (lam) {
    const short = Number(lam[2]) - Number(lam[1])
    return `Not enough SOL. This needs about ${sol(short + 10_000)} SOL more for network fees and account rent. Your wallet has ${sol(walletLamports)} SOL.`
  }
  if (/InsufficientFundsForFee|InsufficientFundsForRent/.test(e) || (/AccountNotFound/.test(e) && walletLamports === 0))
    return `Your wallet doesn’t have enough SOL to pay the network fee. Add at least 0.01 SOL and try again. Your wallet has ${sol(walletLamports)} SOL.`

  // token balance
  if (/Error: insufficient funds/i.test(text)) return 'Your wallet doesn’t hold enough of the token you’re paying with. Lower the amount or top up your balance.'
  if (/account is frozen|Account is frozen|AccountFrozen/i.test(text)) return 'One of your token accounts is frozen by the token’s issuer, so it can’t send or receive right now.'
  if (/paused/i.test(text) && /Token-2022|TokenzQd/i.test(text)) return 'The token issuer has paused transfers for this asset. Try again once it’s resumed.'

  // program errors
  const custom = /"Custom":(\d+)/.exec(e)
  if (custom) {
    const code = Number(custom[1])
    const failing = /Program (\w+) failed: custom program error/.exec(text)?.[1]
    let name: string | undefined
    if (failing === AMM_ID) name = AMM[code]
    else if (failing === DBC_ID || !failing) name = code >= 6000 && code - 6000 < DBC.length ? DBC[code - 6000] : DBC_TAIL[code]
    if (name && PROGRAM[name]) return PROGRAM[name]
    if (name) return `Meteora rejected this transaction (${human(name)}). Nothing was sent.`
    if (code === 1) return 'Not enough balance for this transaction. Check your SOL and token balances.'
  }
  if (/BlockhashNotFound/.test(e)) return 'The network moved on before this could be checked. Nothing was sent. Try again.'
  if (/AccountNotFound/.test(e)) return 'An account this transaction needs doesn’t exist yet. Refresh the page and try again.'
  return 'This transaction would fail on-chain, so it wasn’t sent and nothing was spent. Refresh the page and try again.'
}

/** Any thrown error → one clear sentence for a toast. */
export function friendly(e: any): string {
  if (e instanceof UserError) return e.message
  const m: string = e?.message || String(e)
  const name: string = e?.name || ''

  if (/User rejected|rejected the request|Transaction cancelled|declined|denied/i.test(m) || name === 'WalletSignTransactionError' && /reject/i.test(m))
    return 'You cancelled in your wallet. Nothing was sent.'
  if (name === 'WalletNotConnectedError' || /wallet not connected/i.test(m)) return 'Connect your wallet first.'
  if (name === 'WalletSignTransactionError' || name === 'WalletSignMessageError') return 'Your wallet couldn’t sign this. Unlock it, check it’s on Solana mainnet, and try again.'
  if (/429|Too many requests|rate limit/i.test(m)) return 'Solana’s public network is busy right now. Wait a few seconds and try again.'
  if (/Mainnet RPC unavailable|503|502|504|Bad Gateway/i.test(m)) return 'Couldn’t reach Solana right now. Wait a moment and try again.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Couldn’t reach the network. Check your internet connection and try again.'
  if (/timed out|timeout|AbortError/i.test(m)) return 'The request took too long. Try again in a moment.'
  if (/block height exceeded|expired|Blockhash not found/i.test(m)) return 'The network took too long to confirm, so the transaction expired. Check your wallet history before trying again.'
  if (/not Solana mainnet/i.test(m)) return 'Your connection isn’t pointed at Solana mainnet, so nothing was sent.'
  if (/insufficient/i.test(m)) return 'Not enough balance for this transaction. Check your SOL and token balances.'
  return m.length > 180 ? m.slice(0, 180) + '…' : m
}
