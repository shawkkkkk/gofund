# GoFund Production Runbook

This runbook is the operational counterpart to the code-level launch gates.

## Emergency pause

If there is any accounting discrepancy, suspected compromise, upstream Pump change, RPC instability, fundraiser dispute, or settlement uncertainty:

1. Set `LAUNCH_ENABLED=false`.
2. Set `WORKER_ENABLED=false`.
3. Redeploy / restart the GoFund service so both flags are active.
4. Confirm `/api/health` reports launches and worker disabled.
5. Do not queue or complete any new settlements until reconciliation is restored.
6. Record the incident and affected transaction/campaign IDs in the audit trail and private incident notes.

The public proof ledger remains available during a pause.

## Daily reconciliation

For each asset independently (SOL and USDC):

`campaign fee obligations >= campaign settlement reservations`

and globally:

`confirmed treasury collections >= all queued + processing + completed settlement source amounts`

A settlement must never be queued when either bound would be exceeded. The API enforces both bounds transactionally with PostgreSQL advisory locks.

Before completing a settlement:

- verify the fundraiser URL and campaign status;
- verify the settlement is QUEUED or PROCESSING;
- verify the source asset and source base-unit amount;
- record any conversion reference used to turn SOL/USDC into the fiat donation amount;
- complete the payment using an authorized GoFundMe-supported payment method;
- retain the payment reference or receipt;
- only then mark the settlement COMPLETED.

Never describe a treasury collection as a completed donation.

## Organizer verification and opt-out

Organizer requests are reviewed manually.

For verification:
- confirm the requester controls or is authorized by the fundraiser organizer;
- record the organizer name only after verification;
- change campaign status to VERIFIED through the authenticated internal endpoint;
- preserve the audit-log entry.

For opt-out:
- validate the requester has authority over the fundraiser;
- change the campaign status to OPTED_OUT;
- new/incomplete launches for the campaign become invalid;
- remove the campaign from public discovery;
- do not erase historical on-chain proof records.

## Fraud / sanctions / abuse review

Before unrestricted monetary operation, maintain a review process for:
- impersonation or misleading organizer claims;
- obviously deceptive or manipulated fundraiser references;
- sanctioned persons/jurisdictions where applicable;
- illegal fundraising purposes;
- market manipulation or wash-trading intended to distort the donation ledger;
- malicious token names/images/content.

When uncertain, pause the affected campaign rather than settlement.

## Treasury and automation custody

The configured public treasury is:

`GGciVuVWMy5s4A3v7yUbzpo2nHZAjrh7qeb9qRyGZJoG`

The treasury private key must never be stored in GoFund application environment variables.

The separate fee-payer wallet exists only to fund permissionless creator-fee collection transactions. Keep its balance low and refill it only as needed.

## Production activation order

Do not change the order:

1. Dedicated mainnet RPC configured and `/api/health` verifies mainnet genesis.
2. Fee-payer wallet funded above `MIN_FEE_PAYER_LAMPORTS`.
3. Database migrations green.
4. Current production build green.
5. Confirm organizer/abuse queue is staffed.
6. Confirm settlement operator and treasury custody process.
7. Set `WORKER_ENABLED=true`.
8. Verify fee indexing/collection worker remains healthy.
9. Set `LAUNCH_ENABLED=true`.
10. Perform one controlled low-value canary launch.
11. Verify: create event → creator routing → fee event indexing → treasury collection → campaign obligation.
12. Only after the canary reconciles should unrestricted launches be announced.

## Canary failure

If any canary step fails, immediately disable launches and worker and investigate. Do not retry by manually changing database state to make the ledger appear reconciled.
