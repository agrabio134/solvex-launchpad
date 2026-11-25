# Solvex launchpad

A memecoin launchpad where every coin is priced in **$SVX**. It runs on Meteora's Dynamic Bonding Curve (DBC), and coins graduate to a locked Meteora DAMM v2 pool on Solana.

## Pages
| Route | What it does |
|---|---|
| `/` | Landing page: hero, live stats, then numbered sections 01–05 (live coins, how it works, why Solvex, the loop, FAQ) |
| `/board` | New pairs / Final stretch / Graduated columns, with search and sort |
| `/launch` | Image, name, ticker, socials and an optional first buy in SVX. Creates the pool and makes the first buy in one transaction |
| `/coin/:mint` | Price, market cap, curve progress, buy/sell with a live quote and slippage, recent transactions, and a creator fee claim |
| `/profile` | Coins launched from your wallet, with fee claims |
| `/docs` | Docs |

## How the DBC logic is laid out
- `scripts/create-config.ts`: you run this once to create **the** Solvex DBC config. It sets $SVX as the quote mint, the curve (launch and graduation market cap), the fees and the creator share, and 100% locked LP. Graduation migrates to DAMM v2.
- `src/lib/dbc.ts`: everything the app does on-chain:
  - `fetchCoins`: `getPoolsByConfig`, then Metaplex metadata, then the JSON image
  - `buildLaunchTx`: `createPoolWithFirstBuy`, where the new mint keypair co-signs
  - `quoteSwap` / `buildSwapTx`: `swapQuote` and `swap` (buy = SVX → coin, sell = coin → SVX)
  - `buildClaimCreatorFeeTx`: `claimCreatorTradingFee`
- `api/upload.ts`: a Vercel function that pins the image and metadata JSON to IPFS through Pinata, so the JWT stays on the server.
- `scripts/claim-partner-fees.ts`: claims the Solvex share of fees from every pool.

## Setup
```bash
npm install --legacy-peer-deps
cp .env.example .env          # fill in RPC, SVX mint + decimals

# 1. create the launchpad config (dry run first, then for real)
npm run create-config
npm run create-config -- --send     # needs PARTNER_KEYPAIR (a JSON keypair with SOL)
#    -> put the printed key in VITE_DBC_CONFIG

# 2. run it (vercel dev also serves /api/upload)
npx vercel dev
```
Optional curve and fee settings for the config script go in `.env`: `INITIAL_MCAP_SVX` (default 30,000), `MIGRATION_MCAP_SVX` (400,000), `TRADING_FEE_BPS` (100 = 1%), `CREATOR_FEE_PCT` (50), `POOL_CREATION_FEE_SVX` (0). Once a config exists on-chain, its parameters can't be changed. To change them, create a new config.

While `VITE_DBC_CONFIG` or `VITE_SVX_MINT` is empty, the app runs in **preview mode**. It shows sample coins under a banner and turns trading off.

## Deploy (Vercel)
1. Import the repo.
2. Add every `VITE_*` variable and `PINATA_JWT`.
3. Deploy. `vercel.json` already handles SPA routing.

Use a paid RPC such as Helius or Triton. The board calls `getProgramAccounts`, and the public RPC rate-limits it.
