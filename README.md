# GoFund

**Every trade gives.**

GoFund is a fundraising launchpad for Pump tokens. A launcher selects a public GoFundMe campaign, creates a coin, and the Pump coin is created with the **GoFund treasury as its creator-fee recipient from genesis**. The launcher's wallet pays for the token creation but is never the creator-fee destination.

> GoFund is independent and is not affiliated with, endorsed by, or operated by GoFundMe or Pump.fun.

**Production treasury (public address):** `GGciVuVWMy5s4A3v7yUbzpo2nHZAjrh7qeb9qRyGZJoG`

## Core invariant

A token is never shown as active until GoFund independently verifies on-chain that:

1. the confirmed transaction message matches the exact server-built GoFund fingerprint;
2. the transaction payer is the launcher's wallet;
3. the mint, name, ticker, metadata URI, and quote asset match the GoFund draft;
4. the Pump creator in the create event is the configured GoFund treasury;
5. the bonding-curve creator read from chain is also the configured GoFund treasury.

Pump's current `create_v2` model makes the `creator` argument the creator-fee recipient for a normal SOL/USDC coin. GoFund sets that address at creation instead of asking the launcher to redirect fees afterward.

## V1 flow

1. Paste a canonical GoFundMe URL. GoFund validates the URL format but does not scrape campaign content.
2. Connect a Solana browser wallet.
3. Enter a community-supplied fundraiser label, token name, ticker, description, SOL/USDC pair, and upload an image. GoFund sends the image + metadata to Pump's IPFS endpoint and cryptographically binds the returned metadata URI to that exact draft.
4. Optionally choose a first buy (up to 10 SOL or 10,000 USDC). A first buy is the launcher's token purchase, not a fundraiser donation.
5. GoFund builds the exact unsigned Pump transaction server-side, stores a SHA-256 fingerprint of the message, and returns it for wallet signatures. The `user` is the launcher while `creator` is the GoFund treasury.
6. The relay accepts only the exact fingerprinted GoFund transaction. The wallet and mint both sign it.
7. After confirmation, GoFund independently fingerprints the on-chain transaction again, parses the Pump create event, and reads the bonding curve before marking the launch active.
8. Per-trade creator-fee events create campaign obligations; treasury collections are tracked separately; GoFundMe settlements become completed only with a real payment reference or receipt.

The crypto fee record and the GoFundMe donation are intentionally distinct states. The UI must never call funds “donated” until the GoFundMe-side settlement is completed.

## Setup

```bash
cp .env.example .env.local
npm install
psql "$DATABASE_URL" -f db/schema.sql
npm run dev
```

Use a production-grade Solana RPC before monetary launch. The public mainnet RPC is only a development fallback.

## Required environment variables

See `.env.example`.

- `GOFUND_TREASURY` and `NEXT_PUBLIC_GOFUND_TREASURY` must be the same public key.
- `DATABASE_URL` points to PostgreSQL.
- `INTERNAL_API_SECRET` protects operator/worker routes.
- `FEE_PAYER_SECRET_KEY` is a separate low-balance automation signer when a permissionless crank transaction needs gas. It must not be the treasury key.

## Production gates

- Production RPC configured and rate limits understood.
- PostgreSQL initialized with `db/schema.sql`.
- Treasury public key configured identically on client and server.
- Internal worker/admin endpoints protected.
- Fee accounting/indexing reconciles to on-chain events before settlement.
- An approved operational process exists for GoFundMe settlement before completed payouts are shown as donations.
- Organizer verification and opt-out handling are operational.
- Fraud/sanctions screening, accounting controls, incident response, privacy/terms disclosures, and legal review are complete before public monetary operation.

## Why settlement is separate

GoFund intentionally does not scrape GoFundMe or automate its checkout without an authorized integration. The accounting model is:

`creator fees generated -> GoFund-controlled fee destination -> campaign obligation -> completed GoFundMe donation`

That reconciliation is a product feature, not a hidden operational detail.


## Public receipts

GoFund keeps each accounting stage separate:

- `fee_events`: per-token Pump/PumpSwap creator-fee obligations attributed to a fundraiser.
- `GFC-######`: numbered treasury collection receipts for confirmed creator-vault sweeps.
- `GFS-######`: numbered fundraiser settlement receipts.
- `HELD`: a settlement that remains reserved/owed but cannot currently be completed; the public ledger shows the hold reason.
- `COMPLETED`: requires an actual GoFundMe-side donation reference; an on-chain collection alone is never called a donation.
