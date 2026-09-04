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

## Isolated restore rehearsal

1. Record the Production project identity, latest successful backup time, recovery window, migration endpoint, database size and application SHA.
2. Obtain two-person approval for any paid disposable project or branch. Never select Commercial Production as the restore target.
3. Restore the selected recovery point into an isolated commercial project with no outbound email, billing webhooks, cron processing or customer-accessible hostname.
4. Apply no migrations during the initial integrity check. Compare the restored migration ledger with the captured source ledger.
5. Compare aggregate counts for organisations, sites, memberships, staff, rota, original clock events, corrections, attendance reviews, leave, compliance, payroll periods, adjustments, approvals, exports, invitations, outbox and Auth users.
6. Compare deterministic hashes for immutable clock-event, correction, payroll approval and export-audit evidence without exporting personal row data.
7. Verify every membership and legacy account Auth reference resolves, and that no duplicate or cross-organisation link exists.
8. Run read-only manager, kiosk, attendance, leave and payroll smoke checks using synthetic or restored test identities only. Keep all external delivery disabled.
9. Record elapsed restore time, achieved recovery point, missing provider-managed material, role-password resets and Storage limitations.
10. Delete the disposable environment only under its separate approved cleanup procedure after evidence is retained.

## Close-out

Record the failed and restored SHAs, migration state, final health, provider reconciliation, evidence hashes, offline counts, operator, approver and Europe/London completion time.
