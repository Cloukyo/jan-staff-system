# Attendance State Machine Deployment Handoff

## Release boundary

This handoff deploys the online attendance state machine, correction-aware views, manager exception workflow and payroll safeguards. Offline clocking must remain disabled on every production kiosk. The physical-device checklist is a separate gate for a later one-device pilot.

Do not use demo data, enable `offline_enabled`, backfill exceptions or change historical attendance as part of the initial release.

## Migration safety and order

The first six files reconcile migration history already applied in production. Their content is protected by SHA-256 tests and must not be edited or applied again under another version. The four later files are the new additive release sequence.

| Migration | Purpose | Production treatment | Lock and runtime risk | History and rollback |
| --- | --- | --- | --- | --- |
| `20260716144911_fix_manager_hours_preview_ambiguity.sql` | Existing qualified manager-hours preview function | Already applied and reconciled | None during this release | Restored from its original Git commit and verified byte-for-byte against production history; do not rerun |
| `20260723162038_staff_lifecycle_management.sql` | Existing staff lifecycle RPC | Already applied and reconciled | None during this release | Exact production history; do not rerun |
| `20260723162052_enforce_staff_lifecycle_paths.sql` | Existing lifecycle enforcement | Already applied and reconciled | None during this release | Depends on the prior lifecycle migration; do not rerun |
| `20260728230702_clock_event_corrections.sql` | Existing immutable correction-chain schema and effective-ledger RPCs | Already applied and reconciled | None during this release | Exact production history; does not rewrite original events |
| `20260728230820_revoke_clock_correction_trigger_execute.sql` | Existing correction trigger permission hardening | Already applied and reconciled | None during this release | Depends on correction-chain functions; do not rerun |
| `20260729015320_attendance_remove_and_reset.sql` | Existing manager remove/reset operations using correction evidence | Already applied and reconciled | None during this release | Despite its name, it does not delete clock events; do not rerun |
| `20260803160623_attendance_state_machine.sql` | Operational-day state, authoritative kiosk actions, exceptions, idempotency and reconciliation | Apply first | Brief DDL locks while creating tables, indexes, constraints and replacing functions; apply in a quiet window | Additive; old kiosk RPC is replaced with a rolling-deployment-safe implementation; keep schema on app rollback |
| `20260803162518_kiosk_attendance_state_response.sql` | Extends kiosk response contract with authoritative state | Apply second | Short function replacement lock | Depends on the attendance state machine; its JSON object response is not compatible with application SHA `3090800c50f8ea1125ded10660af4b84db87aad5` |
| `20260803173048_manager_attendance_exception_workflow.sql` | Manager exception queries, audited resolution/dismissal and effective-event readers | Apply third | Brief table/index/trigger/function DDL locks | Additive; depends on state-machine and correction-chain objects; retain audit rows on rollback |
| `20260803190153_offline_kiosk_attendance.sql` | Dormant per-device authorisations, signed sync boundary, conflict metadata and kiosk health | Apply fourth | Table scans for new indexes on attendance tables plus brief DDL locks; apply in a quiet window | Additive and disabled by default; retain all audit columns/tables if the app is rolled back |

The migrations do not delete `clock_events`, rewrite original event timestamps, fabricate clock-outs or modify historical attendance rows. Inserts into `clock_events` occur only inside guarded runtime functions after deployment. The original four-migration release required the database changes before the application deployment. The 4 August maintenance repair is application-only and must not change the production database contract.

## 4 August 2026 rollback compatibility incident

Do not restore application SHA `3090800c50f8ea1125ded10660af4b84db87aad5` or deployment `dpl_Do3ZUnFuCJ6CmKVQL3dGXcsAafhW` while `verify_device_kiosk_pin(text,text,text)` returns a JSON object. That application reads the RPC result as a PostgREST row array, so valid PINs reach the database but the application reports `request_failed` and records no attendance action.

The approved application rollback target is SHA `c20371f98b50cd7ff9a3ba445369d7a0bc3c3522`, which consumes the existing JSON response. There is no single database response shape that safely supports both that build and SHA `3090800c50f8ea1125ded10660af4b84db87aad5`: changing the RPC to a PostgREST row would remove the authoritative state as interpreted by the current build. Keep the JSON contract, deploy the dual-shape application mapper only, and never use SHA `3090800c50f8ea1125ded10660af4b84db87aad5` as a rollback target. Never infer database compatibility solely from a migration being additive; verify every RPC response contract used by the rollback build.

## Pre-deployment evidence

Record these values in the change ticket before touching production:

- Backup status, timestamp and restore owner
- Current application commit and deployment URL
- Output of `supabase migration list` while linked to production
- Count of registered kiosks and `offline_enabled = true` devices, which must be zero
- Release branch commit and reviewed pull request
- Named deployer, verifier and rollback decision-maker

From the repository checkout, use the documented commands only after confirming the Supabase CLI is linked to the intended production project:

```powershell
npx.cmd supabase migration list
npx.cmd supabase db push
```

Do not use `--include-all`, repair migration history or reset the database during this release. Stop if the first six reconciled versions are not already recorded exactly once.

## Controlled online deployment order

1. Confirm the current production backup is recent, successful and restorable; record its timestamp and owner.
2. Record the currently deployed application commit and its rollback deployment.
3. Run `npx.cmd supabase migration list` against production and save the output.
4. Query registered devices and confirm every device has offline clocking disabled. Do not continue if any device is enabled.
5. Review the pending migration list. It must contain only the four new attendance migrations in the order shown above.
6. Run `npx.cmd supabase db push` from the reviewed release commit during a quiet window.
7. Run `npx.cmd supabase migration list` again and confirm all four versions completed once and in order.
8. Deploy the reviewed application commit through the existing hosting release process. Do not change environment variables other than selecting the reviewed commit.
9. On the ordinary online kiosk, verify device registration and PIN login using the approved controlled staff test.
10. Perform one controlled normal clock-in and verify one immutable event, the correct Europe/London operational date and the authoritative `clocked_in` state.
11. Perform the matching controlled normal clock-out and verify one immutable event, correct pairing and duration.
12. Use a safe synthetic equivalent in a non-production staff record, or a pre-approved controlled case, to confirm yesterday's incomplete shift cannot become today's clock-out and instead requires review.
13. Open the manager attendance exception screen and verify the controlled issue, source evidence and authoritative state are visible.
14. Resolve one controlled exception through the correction chain, then dismiss a separate controlled non-actionable exception. Verify the manager audit for both.
15. Verify the weekly-hours view uses only same-operational-day effective pairs and shows the correction exactly once.
16. Verify the manager-hours view matches the same effective ledger and does not pair across days.
17. Verify payroll preparation, review warnings and export acknowledgement. Confirm it neither invents missing hours nor includes unresolved offline evidence.
18. Verify dashboard attendance totals and currently-clocked-in counts match the authoritative state results.
19. Query every production kiosk again and confirm offline remains disabled. Review application, Postgres and authentication logs for permission, RPC, duplicate or state errors.
20. Reconcile the first live operational day against expected clock events, exception decisions, effective hours, dashboard totals and payroll readiness before closing the change.

## Rollback triggers

Stop the rollout and begin rollback if any of the following occurs:

- Normal PIN login, clock-in or clock-out fails
- A controlled request produces duplicate events or more than one authoritative result
- Existing original attendance appears missing or changed
- Effective, weekly or manager totals differ unexpectedly
- Yesterday's incomplete shift is treated as today's clock-out
- Manager exception resolution or dismissal fails
- Payroll totals or readiness warnings become inconsistent
- Dashboard or kiosk state is incorrect
- Migration, RLS, grant or RPC permission errors occur
- Logs show service-role exposure, unexpected direct writes or repeated sync failures

## Evidence-preserving rollback

1. Confirm `offline_enabled = false` for every device and leave it false.
2. Stop further controlled testing. Record affected staff, operation UUIDs, event IDs, exception IDs, timestamps and the deployed commit without copying PINs or credentials.
3. Re-deploy only a previously recorded application commit whose RPC response contracts were verified against the current schema. For the 4 August maintenance release, use SHA `c20371f98b50cd7ff9a3ba445369d7a0bc3c3522`; never use SHA `3090800c50f8ea1125ded10660af4b84db87aad5`.
4. Do not run a database reset, reverse migration, `DELETE`, `TRUNCATE` or destructive repair.
5. Keep every newly written `clock_events` row, correction, exception, idempotency request, offline authorisation, receipt and health record.
6. If an RPC itself must be disabled, apply a separately reviewed forward migration that rejects new affected operations while preserving stored idempotent responses and audit evidence.
7. Verify the restored online kiosk flow and use the documented manager correction procedure for any controlled evidence requiring resolution.
8. Reconcile attendance, weekly hours, manager hours, dashboard and payroll before reopening normal use.
9. Preserve logs and SQL outputs with the incident record, then investigate on a new branch and preview database.

The additive schema intentionally remains after application rollback so no attendance evidence is destroyed. Earlier application code may coexist only when its exact RPC response contracts have been verified against the retained schema.

## Later offline pilot gate

Only after the online release is stable may a separate change complete [the physical kiosk checklist](offline-kiosk-physical-test.md). One preview or staging device must pass storage, restart, clock-change, expiry and revocation checks before any production device is considered. Production offline enablement requires a separate reviewed change and is not part of this handoff.
