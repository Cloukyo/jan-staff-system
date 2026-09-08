# Recruitment receipt timing correction

## Approved rule

For work date D, the required check must have an explicitly confirmed receipt date on or before D. Start authorisation, suitability and applicable verification decisions must also be effective on or before D. Appointment dates cannot be in the future relative to D. SQL date values compare directly; timestamps are converted to Europe/London calendar dates. Same-day acceptance is a product calendar-date rule, not a claim about intraday statutory ordering.

The occasional supervised volunteer exception remains restricted to the existing explicit volunteer classification, requirement and exception fields. It is not an employee override. Managers must ensure the role actually qualifies, including no overnight work or personal care under that exception.

## Historical evidence and provenance

- The original compliance schema recorded issue and last-check dates, not confirmed receipt timing.
- The Competitive Readiness migration backfilled receipt from `coalesce(dbs_issue_date, dbs_last_checked_at)` for historical records. These values have no reliable receipt provenance.
- Import recruitment fields start at assessment/pending evidence. Imports do not confirm receipt.
- The former central-record form could retain an inferred date while changing status to verified. Status alone is therefore not proof of receipt provenance.
- No existing rows are mass-confirmed or rewritten. All historical values remain recorded evidence. A separate append-only confirmation establishes timing for the exact current check.
- The existing legacy-record path is preserved for recorded checks with appointment before 1 September 2026. This is compatibility policy, not a new statutory exemption. Unknown timing blocks operational eligibility until reviewed, but does not itself require a replacement DBS.

## Manager resolution

Open Staff, the staff record, Training and checks, then DBS and suitability. Review the historical evidence and save any changes first. Use Confirm receipt timing, enter the actual receipt/clearance date and explain the evidence reviewed. Do not substitute the issue date or last-check date. The input is deliberately blank rather than prefilled with an inferred date.

The RPC checks organisation-wide compliance permission, locks the central record, rejects stale versions and future receipt attestations, updates the actual receipt date and records the actor, previous date, evidence note and audit timestamp atomically. A fingerprint binds confirmation to the central-record identity, requirement, check level, issue date, last-four value, encrypted reference and receipt date. Changing those values requires fresh confirmation. Verification and suitability history remain intact. Audit confirmation time is not used as the historical receipt effective date.

## Enforcement and display

The private operational helper remains inaccessible to API roles. The invoker readiness view intentionally repeats its predicate rather than granting private helper execution; tests compare its output with both the helper and application model. The application distinguishes ready, future-effective, missing, unconfirmed receipt timing, explicit exception and inactive states. Exports label recorded receipt dates separately from timing confirmation.

Rota assignment/update and kiosk enablement enforce the rule. New commercial kiosk clock-ins also enforce it for already-enabled staff. Clock-outs, original events and separately recorded manager corrections remain available and unmodified. This migration does not recalculate pay or attendance, rewrite historical migrations, or revoke the ability to finish recording an existing shift.

## Verification and rollout boundaries

Starting commercial main: `9d0044f3b6f045d2ebe5ec4b59b2c44304fc87c1`. Correction branch: `codex/recruitment-receipt-date-guard`.

Before application, Commercial Staging had 77 matching migrations ending at `20260904041235`, and zero commercial central records. No existing staging records require remediation. Re-run aggregate provenance assessment separately before any future Production rollout; do not assume Production has the same data.

The focused test suite covers employee/volunteer before/on/after dates, legacy uncertainty and resolution, confirmation invalidation, stale writes, audit integrity, tenant permissions, rota, kiosk, clock-ins, clock-outs and London BST/GMT boundaries. `supabase/tests/recruitment_receipt_dates.sql` exercises the actual fully migrated schema with synthetic records inside a rolled-back transaction. PGlite tests use a reduced schema and do not replace the full-schema checks.

Apply only the new forward migration to positively identified Commercial Staging, compare complete ledger ordering/names, run the rolled-back full-schema tests and security checks, and deploy the exact green commercial-main SHA using the existing staging workflow. Confirm London runtime, liveness/readiness and zero synthetic residue. Production and Jan are excluded.

## Failure and forward recovery

Do not delete ledger entries, erase confirmation history or restore the old future-date bypass. If rollout verification fails, stop application promotion and preserve evidence. A reviewed forward corrective migration should repair the failing implementation while keeping uncertain receipt timing fail-closed. If an application rollback is necessary, older UI cannot resolve receipt uncertainty; retain the database safeguard and provide supervised manager remediation through the guarded RPC until the corrected UI is available. Any Production rollout needs its own backup/recovery and legacy-remediation approval.

## Sources and scope

The rule follows the approved product interpretation of the [EYFS framework effective September 2026](https://www.gov.uk/government/publications/early-years-foundation-stage-framework--2), paragraphs 3.15-3.18 and their volunteer-exception footnotes. The [DBS supervision-exemption update](https://www.gov.uk/government/publications/working-or-volunteering-in-regulated-activity-with-children/regulated-activity-removal-of-the-supervision-exemption-comes-into-force-1-september-2026) does not justify a general supervision override. Receipt provenance and day-level comparisons are explicit product controls, not automated legal certification.

General UI/UX work remains paused until the correction is fully verified in Commercial Staging. Resume from already merged UX progress, not from the historical audit baseline.

## Staging database verification, 8 September 2026

The Supabase migration tool assigned version `20260908015659_recruitment_receipt_date_guard`; the new, previously uncommitted repository migration was renamed to match that recorded version without changing SQL. No historical migration or ledger entry was rewritten.

The real-schema rolled-back transaction passed employee and volunteer before/on/after receipt and authorisation cases, unconfirmed and changed evidence, legacy manager resolution without replacement DBS, the actual rota and kiosk triggers, new clock-in enforcement and clock-out preservation, London midnight, view/helper parity, stale confirmation audit integrity and unauthorised confirmation rejection. The fixture correction supplies the required join date for an active synthetic membership. No genuine records were used.

Local verification before staging application: 1,344 tests in 173 files passed, including 57 focused tests. Lint, typecheck, build, migration verification, browser-bundle verification, dependency audit (zero vulnerabilities) and diff whitespace checks passed. CI, full-schema pgTAP/schema lint and exact-SHA staging application deployment remain release gates; this document does not claim those subsequent gates passed until their run evidence is available.
