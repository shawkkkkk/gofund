# Deployment

GoFund production runs as a persistent Node service with:

- pre-deploy database migration: `npm run db:migrate`
- build gate: `npm run typecheck && npm run build`
- launch kill switch: `LAUNCH_ENABLED=false` until treasury/RPC/legal operations are ready
- worker kill switch: `WORKER_ENABLED=false` until the fee payer is funded and the treasury is configured
- liveness: `/api/live`
- readiness: `/api/health`

The deployed commit should always match the current `main` branch before enabling launches.
