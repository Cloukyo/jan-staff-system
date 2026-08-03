# Attendance and Offline Kiosk Rollout

## Current status

The attendance state machine and offline kiosk schema are additive. Offline clocking is disabled by default on every kiosk. Production enablement is outside the current task.

## Pre-production gate

1. Reconcile the production migration list with the repository and take the normal verified database backup.
2. Apply all migrations to a fresh Supabase preview branch.
3. Run database behaviour, RLS, grants, idempotency and concurrency suites with fictional data in a transaction.
4. Remove or roll back every fixture and prove no fictional profiles, devices, events, authorisations or exceptions remain.
5. Run full Vitest, TypeScript, ESLint and production build checks.
6. Scan browser output for service-role values, normal PIN hashes, plaintext PINs, pay data and manager-only data.
7. Run desktop browser-tab and installed-PWA simulations with Background Sync available and unavailable.
8. Complete [the physical kiosk checklist](offline-kiosk-physical-test.md) on the actual nursery device.

## Controlled pilot

1. Deploy the additive schema and application while every device retains `offline_enabled = false`.
2. Confirm online Staff Clock, manager attendance review and payroll preparation behave as before.
3. Register one controlled Jan kiosk, record its hardware verification and enable offline only for that device.
4. Provision it online and confirm roster, authorisation expiry, app/schema version and zero pending queue in manager settings.
5. Compare every offline action UUID with its immutable event or manager exception daily.
6. Confirm no action loss, duplication, order inversion, cross-day pairing or silent timestamp replacement.
7. Confirm payroll excludes pending and conflicted evidence and includes each accepted action once.
8. Run the pilot for at least one complete operational and payroll test period.
9. Expand only after nursery, technical and payroll reviewers sign off the evidence.

## Monitoring

Review last contact, roster refresh, authorisation expiry, app/schema version, clock drift, last sync, failure category, pending count, oldest pending age, unresolved conflicts and reprovision state daily during the pilot. Treat unknown queue state as unresolved attendance evidence.

## Rollback

1. Set `offline_enabled = false` for the pilot device to stop new local actions.
2. Do not clear IndexedDB, unregister the kiosk, delete authorisations or delete audit rows while pending evidence may exist.
3. Keep the device powered and reconnect it. Attempt Sync now and record its diagnostic state.
4. Review and resolve every offline exception through the existing correction chain.
5. Revert the application to the previous compatible release if required. Keep the additive database columns and tables so old clients and preserved evidence remain readable.
6. If an RPC rollback is necessary, deploy a compatible function revision that rejects new offline actions but still returns stored idempotent receipts.
7. Revoke a lost or compromised device. Preserve its action requests, events, exceptions and health history.
8. Confirm online clocking and the manager manual attendance procedure before ending the incident.
9. Reconcile payroll readiness and event totals before resuming payroll preparation.

Never roll back by deleting `clock_events`, correction chains, offline action requests, authorisations, exceptions or device health. Evidence retention takes priority over schema removal.
