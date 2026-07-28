# Residual Release-Blocker Fix Report

Date: 28 July 2026 (Europe/London)

Commit: `3ae872b04224593df05aea629ae8b262cb24c033`

## Outcome

Implemented the three user-authorised residual fixes on
`codex/staff-hours-timeline`. No branch was pushed, no migration was applied,
and no live data or deployment was changed.

## Scoped Review

Reviewed the exact implementation range
`44da9a38045aa4de83effd4f3311ac844b091a34..3ae872b04224593df05aea629ae8b262cb24c033`
against only the three authorised residual findings. No Critical or Important
issues remain in that range.

## Authoritative Correction Writes

- Removed the authenticated insert policy and table insert grant from
  `clock_event_corrections`; authenticated managers retain read access.
- Manager writes now go through the security-definer manual and planned-hours
  RPCs. The internal correction-chain function remains non-executable.
- Added an executable PostgreSQL regression proving an authenticated manager
  receives `permission denied` for direct insert while the authoritative
  manager RPC succeeds.

## Stable Same-Instant Ordering

- Added an immutable event order key based on original or root-correction
  lineage, including a lineage-kind suffix for deterministic cross-table UUID
  collisions.
- Replacements retain their lineage position even though the active correction
  receives a new ID.
- A final primary correction UUID is generated during the server render, bound
  into the server-action context, used by the client preview and passed to the
  database transaction.
- Consequential and planned-hours correction IDs are allocated while the plan
  is built, before persistence.
- SQL effective resolution, manual and planned planning, latest kiosk status,
  TypeScript effective resolution, attendance analysis, payroll and
  self-service summaries use the same order key.
- Added equal-timestamp coverage for additions, replacements, consequential
  alternation, exact cross-table UUID collisions, kiosk latest status, payroll
  and staff self-service.

## Complete Clocking History

- Replaced the independent 250-row original and correction limits with complete
  deterministic PostgREST paging in bounded 1,000-row requests.
- Original and correction pages are fully loaded before correction ancestry and
  active, replaced, excluded or superseded status are resolved.
- Added coverage with 251 originals and 251 corrections where the active leaf
  and its root ancestor fall on different source pages.

## Changed Files

- `supabase/migrations/202607280001_clock_event_corrections.sql`
- `src/app/attendance/page.tsx`
- `src/components/attendance/attendance-correction-controls.tsx`
- `src/components/attendance/production-attendance.tsx`
- `src/components/attendance/staff-hours-timeline.tsx`
- `src/lib/attendance/correction-actions.ts`
- `src/lib/attendance/effective-events.ts`
- `src/lib/attendance/manual-correction-plan.ts`
- `src/lib/attendance/sequence.ts`
- `src/lib/kiosk/server.ts`
- `src/lib/payroll/calculations.ts`
- `src/lib/payroll/server.ts`
- `src/lib/payroll/types.ts`
- `src/lib/staff-self-service/server.ts`
- `tests/attendance-correction-action.test.ts`
- `tests/attendance-corrections-db.test.ts`
- `tests/attendance-corrections.test.ts`
- `tests/attendance-manager-views.test.ts`
- `tests/helpers/attendance-corrections-db.ts`
- `tests/payroll-production.test.ts`
- `tests/staff-self-service.test.ts`
- `.superpowers/sdd/2026-07-28-staff-hours-timeline/residual-fix-report.md`

## TDD Evidence

Red states were observed before implementation for:

- authenticated manager direct insert unexpectedly succeeding;
- replacement and superseded-add IDs changing equal-time event order;
- the zero UUID producing a different add preview position;
- missing database `event_order_key`;
- cross-page history loader absence;
- payroll and self-service re-sorting equal-time effective events by active ID;
- form data overriding the correction ID used by the preview.

Each regression was then rerun green.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Focused attendance, PostgreSQL, history, kiosk and downstream tests | `npm.cmd test -- tests/attendance-corrections.test.ts tests/attendance-corrections-db.test.ts tests/attendance-correction-action.test.ts tests/attendance-manager-views.test.ts tests/attendance-review.test.ts tests/attendance-range.test.ts tests/paged-attendance-loaders.test.ts tests/kiosk.test.ts tests/staff-self-service.test.ts tests/payroll-production.test.ts tests/payroll-review.test.ts` | PASS: 11 files, 178 tests |
| Full suite | `npm.cmd test -- --maxWorkers=4` | PASS: 33 files, 375 tests |
| ESLint | `npm.cmd run lint` | PASS |
| TypeScript | `npm.cmd run typecheck` | PASS |
| Production build | `npm.cmd run build` | PASS |
| Diff whitespace | `git diff --check` | PASS |

## Remaining Risk

- Clocking history now deliberately loads all audit records in bounded network
  pages before client filtering and pagination. Memory use therefore grows with
  audit history size. This is appropriate for the current nursery dataset and
  meets the approved complete-bounded-paging option; a database cursor RPC can
  replace it if the dataset becomes materially larger.
- Offset-based source paging is not a transactionally consistent snapshot if
  clock events are written while a multi-page history request is in progress.
  The deterministic ordering prevents unstable ties, but a future database
  cursor RPC would be the stronger option if the audit history regularly grows
  beyond one source page.
- The production build retains the existing multiple-lockfile workspace-root
  warning. Compilation, type checking and route generation complete.
- Authenticated browser verification is deferred until the unapplied migration
  is available in a non-production or approved production database.
