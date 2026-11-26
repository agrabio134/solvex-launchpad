# Flip launchpad

Memecoin launchpad on Meteora's Dynamic Bonding Curve where every market is priced in **$FLIP**.
Same model as FirePad: each launch creates its own curve config + market in one atomic transaction,
with the platform wallet as fee partner. Curves graduate into locked Meteora DAMM v2 pools on Solana.

## How it works
| Step | What happens |
|---|---|
| Launch | Image + metadata are stored in Vercel Blob. One transaction creates a DBC config (quote = $FLIP, fee claimer = platform wallet) and the coin's market. Opening ≈ $4K and graduation ≈ $35K market cap, converted to $FLIP at the live price. Fee 1–3%, optional anti-snipe shield (10% → fee over 5 min) and dynamic fee. Optional first buy right after. |
| Trade | Quotes come from the real curve state; every transaction is simulated on mainnet before the wallet signs, then confirmed by polling. |
| Graduate | When the curve is full, anyone can press **Migrate** to move liquidity into a DAMM v2 pool (LP permanently locked, split creator / platform). Trading then routes through DAMM v2 on the same page. |
| Fees | Creator and platform each get 50% of curve trading fees (after Meteora's share), and both claim locked-LP fees after graduation. |
| Discovery | Markets = pools whose config's fee claimer is the platform wallet and quote mint is $FLIP. |

## Pages
`/` landing · `/board` New / Final stretch / Graduated · `/launch` · `/coin/:mint` chart, trades, buy/sell, migrate, fee claims · `/profile` your coins (the platform wallet sees every market and its fees) · `/docs`

## Code
- `src/lib/dbc.ts`: all chain logic (launch, discovery, quotes, swaps on curve or DAMM v2, migration, fee claims, simulate-then-sign submit)
- `api/rpc.ts`: mainnet RPC relay; real endpoint in `RPC_URL`, method allowlist, filtered program scans only, rate limit, genesis check
- `api/upload.ts`: image + metadata to Vercel Blob (validated, rate limited)
- `api/market-data.ts`: $FLIP USD price (GeckoTerminal)

## Setup
1. Copy `.env.example`; set `VITE_FLIP_MINT`, `VITE_PLATFORM_WALLET`, `RPC_URL`.
2. Connect a Vercel Blob store to the project (adds `BLOB_READ_WRITE_TOKEN`).
3. `npm install --legacy-peer-deps && npx vercel dev`, or push to GitHub (Vercel auto-deploys `main`).
