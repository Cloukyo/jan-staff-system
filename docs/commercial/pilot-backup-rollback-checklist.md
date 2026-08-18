# Pilot Backup and Rollback Checklist

## Before a staging or future pilot release

- Confirm the target is the independent commercial project and not Jan Production.
- Record the application SHA, migration ledger, Supabase backup/PITR status, deployment URL and environment-variable inventory.
- Record counts and deterministic hashes for original clock events and corrections.
- Confirm unresolved exceptions, open shifts, offline-enabled devices and offline authorisations.
- Confirm Stripe resources are sandbox-only for staging.
- Confirm the previous verified application SHA remains deployable.

## Application rollback

1. Stop promotion and retain logs, request IDs and provider event IDs.
2. Re-point only the commercial staging alias to the previous verified SHA.
3. Do not reverse additive migrations destructively.
4. Re-run readiness, authentication, tenant isolation, attendance and billing reconciliation checks.
5. Verify original clock-event and correction hashes remain unchanged.

## Database and provider recovery

- Use Supabase PITR or backups only under an incident-specific approved recovery plan; never restore over a healthy environment merely to undo application code.
- Replay signed Stripe events through the supported idempotent webhook boundary and reconcile the authoritative subscription before manual changes.
- Rotate only the affected staging secret and update its direct environment store without printing or committing it.
- Preserve notification outbox, export audit, attendance and correction evidence.

## Close-out

Record the failed and restored SHAs, migration state, final health, provider reconciliation, evidence hashes, offline counts, operator, approver and Europe/London completion time.
