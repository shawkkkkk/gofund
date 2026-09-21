# GoFund Launch Checklist

## Code / protocol
- [x] Pump V2 launch path implemented
- [x] GoFund treasury is creator-fee recipient from token genesis
- [x] Server verifies confirmed Pump create event
- [x] Server verifies bonding-curve creator matches GoFund treasury
- [x] SOL and USDC quote assets supported
- [x] Pump and PumpSwap fee-event indexing implemented
- [x] Treasury collection journal has prepared/sent/confirmed recovery states
- [x] Settlement reservations are bounded by campaign-earned fees and collected treasury liquidity
- [x] Campaign opt-out and verification states exist
- [x] Public proof ledger separates fee events, treasury collections, and GoFundMe settlements
- [x] Mainnet launch kill switch exists
- [x] Worker kill switch exists
- [x] Public launch endpoints are rate limited and request-size limited
- [x] Liveness and readiness endpoints are separate
- [x] Terms, privacy, disclosures, organizer process, security policy, robots, and sitemap exist

## Production infrastructure
- [x] Production PostgreSQL provisioned
- [x] Schema initialized
- [x] Railway production service exists
- [x] Production domain exists
- [x] DB migration runs before deploy
- [x] Build runs TypeScript + Next production build
- [x] Internal API secret configured
- [x] Separate low-balance fee-payer key configured
- [x] Treasury public key configured in both server and client env
- [ ] Production-grade Solana RPC configured
- [ ] Fee-payer wallet funded with a small SOL gas balance
- [ ] Worker enabled
- [ ] Mainnet launch switch enabled
- [ ] Current GitHub main deployed to production
- [x] Railway liveness healthcheck set to /api/live

## Operational / legal
- [ ] Treasury custody/multisig policy approved
- [ ] GoFundMe settlement procedure approved and tested
- [ ] Organizer verification/opt-out queue staffed
- [ ] Fraud/sanctions screening procedure approved
- [ ] Accounting/reconciliation owner assigned
- [ ] Incident-response contacts and pause procedure documented
- [ ] Legal review completed before unrestricted public monetary operation

GoFund must remain with `LAUNCH_ENABLED=false` and `WORKER_ENABLED=false` until the unchecked infrastructure and operational gates are complete.
