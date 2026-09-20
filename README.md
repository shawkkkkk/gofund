# GoFund

**Every trade gives.**

GoFund is a fundraising launchpad for Pump tokens. A launcher selects a public GoFundMe campaign, creates a coin, and the Pump coin is created with the **GoFund treasury as its creator-fee recipient from genesis**. The launcher's wallet pays for the token creation but is never the creator-fee destination.

> GoFund is independent and is not affiliated with, endorsed by, or operated by GoFundMe or Pump.fun.

## Core invariant

A token is never shown as active until GoFund independently verifies on-chain that:

1. the submitted transaction contains the expected Pump create event;
2. the transaction payer is the launcher's wallet;
3. the mint, name, ticker, metadata URI, and quote asset match the GoFund draft;
4. the Pump creator in the create event is the configured GoFund treasury;
5. the bonding-curve creator read from chain is also the configured GoFund treasury.

Pump's current `create_v2` model makes the `creator` argument the creator-fee recipient for a normal SOL/USDC coin. GoFund sets that address at creation instead of asking the launcher to redirect fees afterward.

## V1 flow

1. Paste a canonical GoFundMe URL. GoFund validates the URL format but does not scrape campaign content.
2. Connect a Solana browser wallet.
3. Enter a community-supplied fundraiser label, token name, ticker, image URL, description, and SOL/USDC pair.
4. GoFund drafts a Pump `create_v2` transaction whose `user` is the launcher and whose `creator` is the GoFund treasury.
5. The wallet signs one creation transaction.
6. GoFund parses the confirmed Pump create event and reads the bonding curve before marking the launch active.
7. On-chain fee events are reconciled to the named fundraiser; GoFundMe settlements are recorded as a separate state and are never mislabeled as on-chain donations.

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
