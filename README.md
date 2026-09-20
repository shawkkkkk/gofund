# GoFund

**Every trade gives.**

GoFund is a fundraising launchpad for Pump tokens. A launcher selects a public GoFundMe campaign, launches a coin, and permanently locks **100% of that coin's Pump creator-fee share** to the GoFund treasury. GoFund keeps a per-token/per-campaign ledger, permissionlessly distributes creator fees on-chain, and separately records completed GoFundMe donations.

> GoFund is independent and is not affiliated with, endorsed by, or operated by GoFundMe or Pump.fun.

## Core invariant

A token is never shown as **Locked** until GoFund verifies on-chain that its Pump fee-sharing config:

1. is finalized / admin-revoked;
2. has exactly one shareholder;
3. assigns 10,000 bps (100%) to `GOFUND_TREASURY`.

Pump's current fee-sharing program makes the final reward distribution one-time and immutable. GoFund uses that property as the source of truth instead of trusting a database flag.

## V1 flow

1. Paste a GoFundMe URL and preview its public metadata.
2. Connect a Solana browser wallet.
3. Generate a mint locally and create the coin through the official `@pump-fun/pump-sdk`.
4. Create the Pump fee-sharing config and finalize it to 100% GoFund treasury.
5. GoFund verifies the config on-chain before registering the coin as locked.
6. A worker permissionlessly distributes accrued creator fees to the treasury and records each transaction.
7. GoFund settles campaign balances through GoFundMe-supported payment methods and records the completed donation separately.

The crypto claim and the GoFundMe donation are intentionally distinct states. The UI must never call fees “donated” until the GoFundMe-side settlement is completed.

## Setup

```bash
cp .env.example .env.local
npm install
psql "$DATABASE_URL" -f db/schema.sql
npm run dev
```

Set a real Solana RPC before production. Public mainnet RPC is only a development fallback.

## Required environment variables

See `.env.example`. The treasury public key must match in both public and server env. Keep the treasury private key offline / under controlled custody; the fee-distribution worker does **not** need it because Pump fee distribution is permissionless. `FEE_PAYER_SECRET_KEY` should be a separate low-balance gas wallet.

## Production checklist

- Replace the development RPC endpoint with a paid, rate-limited provider.
- Put PostgreSQL behind TLS and run `db/schema.sql`.
- Configure `NEXT_PUBLIC_GOFUND_TREASURY` and `GOFUND_TREASURY` to the same address.
- Fund the separate worker fee payer with a small amount of SOL.
- Configure `INTERNAL_API_SECRET` and schedule `POST /api/internal/claims`.
- Establish an approved operational process for GoFundMe settlement before presenting completed payouts as donations.
- Add sanctions/fraud screening, campaign opt-out handling, accounting controls, incident response, and counsel review before public monetary operation.

## Why settlement is separate

GoFundMe's public platform does not provide a general arbitrary-campaign crypto payout rail. GoFund therefore tracks:

`creator fees generated -> distributed to treasury -> owed to campaign -> completed GoFundMe donation`

That reconciliation is a product feature, not a hidden operational detail.
