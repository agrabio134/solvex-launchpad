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

/** pump.fun bonding-curve errors that users can actually hit, in plain words (codes from the pump program IDL). */
const PUMP: Record<number, string> = {
  6002: 'The price moved past your slippage limit before the trade landed. Nothing was spent. Try again, or allow a little more slippage.',
  6003: 'The price moved past your slippage limit before the trade landed. Nothing was spent. Try again, or allow a little more slippage.',
  6042: 'The price moved past your slippage limit before the trade landed. Nothing was spent. Try again, or allow a little more slippage.',
  6005: 'This curve just completed and pump.fun is moving it to PumpSwap. Trading resumes on this page in a minute.',
  6081: 'This coin has graduated to PumpSwap. Refresh the page to trade it there.',
  6107: 'This coin has graduated and is waiting for its PumpSwap pool. Try again in a minute.',
  6020: 'That amount is too small to trade. Enter a bigger amount.',
  6022: 'That amount is too small to trade. Enter a bigger amount.',
  6021: 'There aren’t enough tokens left on the curve for a buy this size. Try a smaller amount.',
  6023: 'There isn’t enough in the curve for a sell this size. Try a smaller amount.',
  6040: 'Not enough SOL to cover the account rent for this buy. Add a little SOL and try again.',
  6041: 'Not enough to cover the trading fees for this amount. Lower it a little and try again.',
  6043: 'The coin name is too long for pump.fun. Use a shorter name.',
  6044: 'The ticker is too long for pump.fun. Use a shorter ticker.',
  6045: 'The metadata link is too long. Try the launch again.',
  6046: 'pump.fun has paused new coin creation for now. Try again later.',
  6063: 'pump.fun doesn’t accept this pair asset for new coins. Choose another pair.',
  6064: 'pump.fun doesn’t accept this pair asset for new coins. Choose another pair.',
  6065: 'The pair asset’s account in this launch is wrong. Refresh the page and try again.',
  6082: 'Cashback coins can no longer be created on pump.fun.',
  6024: 'That amount is too large to process. Try a smaller amount.',
  6000: 'This wallet isn’t allowed to do that on this coin.',
  6019: 'Only the coin’s creator can do that.',
}
/** PumpSwap AMM errors (after graduation). */
const AMM: Record<number, string> = {
  6004: 'The price moved past your slippage limit before the trade landed. Nothing was spent. Try again, or allow a little more slippage.',
  6040: 'The price moved past your slippage limit before the trade landed. Nothing was spent. Try again, or allow a little more slippage.',
}
const PUMP_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
const AMM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
const JUP_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'

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
    if (failing === PUMP_ID && PUMP[code]) return PUMP[code]
    if (failing === AMM_ID && AMM[code]) return AMM[code]
    if (failing === JUP_ID && (code === 6001 || code === 6017)) return 'The price moved past your slippage limit on the SOL leg. Nothing was spent. Try again, or allow a little more slippage.'
    if (failing === PUMP_ID) return `pump.fun rejected this transaction (error ${code}). Nothing was sent.`
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
