# Security

GoFund moves real-value creator fees. Treat every launch and settlement path as financial infrastructure.

## Never commit secrets

Do not commit:
- treasury private keys
- fee-payer secret keys
- database credentials
- RPC credentials
- internal API secrets

The fee-distribution worker uses a separate low-balance gas wallet. The GoFund treasury public key is safe to expose; its private key is not required for permissionless Pump fee distribution.

## Reporting

Do not open a public issue for a vulnerability that could cause loss of funds, false accounting, unauthorized settlement changes, or bypass of fee-lock verification. Contact the repository owner privately first.

## Production requirements

Before enabling public monetary operation:
- verify the Pump fee-sharing account on-chain for every listed token;
- use a production Solana RPC;
- enforce database backups and least-privilege credentials;
- put internal settlement endpoints behind server-only authentication;
- use controlled custody or a multisig for treasury operations;
- reconcile on-chain distributions against settlement records;
- test failure recovery for partially completed launches.
