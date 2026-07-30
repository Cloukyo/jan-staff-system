# Attendance State Machine Design

**Date:** 30 July 2026
**Status:** Approved for implementation
**Application:** Jan Pre-School and Nursery staff system

## Purpose

Redesign production attendance around an explicit, server-authoritative state machine while retaining the immutable `clock_events` ledger and the existing production correction-chain architecture.

The primary safety guarantee is:

> An unmatched clock-in from an earlier operational day must never cause a new-day kiosk action to be recorded as a clock-out for the earlier shift.

The design must preserve all original clock evidence, surface anomalies for manager review, prevent fabricated payroll hours, and remain compatible with the production database during rollout.

## Current Production Behaviour

Production attendance is represented by immutable `clock_events` with `clock_in` and `clock_out` event types. The production database also contains an immutable `clock_event_corrections` chain which can add, replace, or exclude effective events without changing the originals.

The kiosk currently derives `clocked_in` or `clocked_out` from the latest effective event across a broad lookback period. PIN verification and event recording use that binary result. Although production already serialises staff attendance writes with an advisory transaction lock, the transition logic still treats any latest `clock_in` as current.

Consequences include:

- An unmatched clock-in from a previous day is interpreted as a current open shift.
- The next requested clock-out can close the wrong operational day.
- Kiosk, dashboard, manager attendance, weekly hours, staff history, and payroll contain separate pairing or latest-event assumptions.
- Payroll can pair adjacent events across local-day boundaries.
- The local repository is behind production and lacks five applied migrations.
- The local manager correction action still attempts a direct `clock_events` insert that production now denies.

The audit baseline was 21 passing test files and 193 passing tests. A read-only production diagnostic found 830 original events, 10 corrections, three consecutive clock-ins, five unmatched clock-outs, nine adjacent pairs longer than 12 hours, and no negative-duration pairs. Four staff were currently clocked in when inspected, with none stale from a previous local day.

## Design Principles

1. `clock_events` remains the immutable source of original attendance evidence.
2. `clock_event_corrections` remains the only manager correction mechanism.
3. Attendance state is derived from the effective event ledger, including corrections and supersession.
4. Exceptions are explicit, persistent, idempotent, and auditable.
5. Read-only state derivation is deterministic and has no database writes.
6. Exception reconciliation is a separate, documented write operation.
7. Kiosk actions are explicit commands, never a toggle.
8. Server time is authoritative for new kiosk events.
9. Payroll pairing cannot cross operational-day boundaries.
10. The implementation remains honestly single-organisation and single-location.

## Migration Reconciliation Gate

No feature migration or attendance implementation may begin until the repository contains the exact production-applied migrations:

1. `20260723162038_staff_lifecycle_management.sql`
2. `20260723162052_enforce_staff_lifecycle_paths.sql`
3. `20260728230702_clock_event_corrections.sql`
4. `20260728230820_revoke_clock_correction_trigger_execute.sql`
5. `20260729015320_attendance_remove_and_reset.sql`

The migration bodies must be recovered verbatim from `supabase_migrations.schema_migrations.statements` or another authoritative production source. They must not be approximated from the resulting schema.

Reconciliation verification must prove:

- Versions and names match production migration history exactly.
- Statements match the authoritative source exactly after normalising only storage-level line endings.
- Production recognises the versions as already applied.
- A fresh database built from repository migrations contains the same relevant tables, columns, constraints, indexes, triggers, functions, grants, revocations, and policies as production.
- The correction-chain functions operate on the fresh database.

The recovered files are historical records and must not be altered to include the new state-machine feature.

## Operational Day

### Initial rule

The operational timezone is `Europe/London`. The rollover time is local midnight.

For an authoritative timestamp `now`:

- Convert `now` to `Europe/London`.
- The operational date is the resulting local calendar date.
- An effective event belongs to the date obtained by converting its timestamp to `Europe/London`.
- UTC midnight has no independent attendance meaning.

All production attendance consumers must use one central operational-day function or equivalent database expression.

### Daylight-saving behaviour

The database must use named-zone conversion with `Europe/London`, not a fixed UTC offset. Tests must cover the March transition into British Summer Time and the October transition back to Greenwich Mean Time.

### Overnight shifts

Jan Preschool does not currently schedule genuine overnight shifts. Under the initial local-midnight rule, a clock-in before midnight that remains unmatched after midnight becomes `missing_clock_out`. Starting work after midnight creates a new operational-day shift.

Supporting genuine overnight shifts later will require an explicit configurable rollover time or a rota-linked overnight rule. It must not be inferred from UTC date changes or implemented separately by individual consumers.

### Long shifts

A same-operational-day shift is not made stale solely because it exceeds the warning threshold. It remains a current clock-in and gains an `unusually_long_shift` warning or exception. The maximum-duration threshold is centralised and initially defaults to 12 hours.

## Effective Attendance Ledger

State and payroll calculations consume effective events produced by the correction-chain architecture:

- Original events remain effective unless replaced or excluded by an active correction lineage.
- Active added and replacement corrections appear as effective events.
- Superseded corrections do not appear.
- Ordering is deterministic by event timestamp, correction order key, and event identifier.

No state function may derive status only from raw `clock_events`.

## State Model

### Derived kiosk state

```ts
type AttendanceState =
  | "clocked_out"
  | "clocked_in"
  | "missing_clock_out"
  | "missing_clock_in"
  | "awaiting_manager_review";
```

`resolved` is an exception lifecycle outcome rather than a blocking live kiosk state. Resolved history remains visible to managers.

### Explicit actions

```ts
type AttendanceAction =
  | "clock_in"
  | "clock_out"
  | "start_new_shift";
```

A later `report_missing_clock_in` action may reuse the exception service, but it is not required to fix the primary production failure.

### State result

```ts
type AttendanceStateResult = {
  state: AttendanceState;
  operationalDate: string;
  currentEvent: EffectiveAttendanceEvent | null;
  unresolvedExceptions: AttendanceExceptionSummary[];
  allowedActions: AttendanceAction[];
  warnings: AttendanceWarning[];
  revision: string;
  evaluatedAt: string;
};
```

The revision identifies the effective attendance and exception inputs used for confirmation. It must not include PIN data.

## Deterministic State Derivation

`get_attendance_state(staff_id, evaluated_at)` is read-only and returns the same result for the same effective ledger, exception records, configuration, and timestamp.

Rules are applied in this order:

1. Partition effective events by the central operational-date rule.
2. Analyse each day independently as a sequence.
3. Load unresolved exceptions without creating or updating them.
4. Determine whether the current operational day ends with one valid unmatched clock-in.
5. Determine whether earlier days contain unmatched or malformed sequences.
6. Return allowed actions and warnings.

### Normal empty state

No valid current-day unmatched clock-in produces:

- State: `clocked_out`
- Allowed action: `clock_in`

### Valid current clock-in

Exactly one valid current-day unmatched clock-in, with no later conflicting current-day event, produces:

- State: `clocked_in`
- Allowed action: `clock_out`
- Current event: the effective clock-in

Older unresolved exceptions remain visible as warnings but do not override the valid current-day state.

### Stale unmatched clock-in

An unmatched clock-in from an earlier operational day, with no valid current-day open shift, produces:

- State: `missing_clock_out`
- Allowed action: `start_new_shift`
- The stale event remains unchanged.
- State derivation does not create the exception.

### Consecutive clock-ins

Two or more clock-ins without an intervening clock-out are malformed:

- Each affected day is marked for `consecutive_clock_in`.
- If the current day still contains one unambiguous final open clock-in, the state is `awaiting_manager_review` until a manager resolves the ambiguity.
- No additional clock-in is allowed.
- A safe clock-out is allowed only if the effective sequence identifies one unambiguous current open shift. Otherwise no kiosk mutation is allowed.

### Unmatched clock-out

A clock-out without a valid earlier clock-in on the same operational day yields:

- `missing_clock_in` when it is the only active anomaly relevant to the requested action.
- An `unmatched_clock_out` exception candidate.
- No fabricated clock-in or zero-length session.
- No normal kiosk clock-out action.

### Multiple malformed events

Multiple anomalies on the current operational day produce `awaiting_manager_review`. The kiosk returns safe explanatory copy and no attendance mutation unless one explicit action is provably safe.

### Valid current shift with older exceptions

A valid current-day unmatched clock-in remains `clocked_in` even when older exceptions are unresolved. The older issues are warnings and manager tasks. They cannot redirect today’s clock-out to an older event.

### Concurrent correction

The confirmation response includes a revision. `perform_attendance_action` reacquires the staff advisory lock and recomputes state and revision. If a manager correction changed effective ordering while the confirmation screen was open, the action returns `state_conflict`, the latest state, and the latest allowed actions without inserting an event.

## Exception Model

### Categories

```ts
type AttendanceExceptionType =
  | "missing_clock_out"
  | "missing_clock_in"
  | "consecutive_clock_in"
  | "unmatched_clock_out"
  | "overlapping_attendance"
  | "unusually_long_shift";
```

Additional warning types may be introduced for rota and leave context without changing clock evidence.

### Lifecycle

```ts
type AttendanceExceptionStatus =
  | "open"
  | "under_review"
  | "resolved"
  | "dismissed";
```

### `attendance_exceptions`

The new table records:

- Stable UUID
- Staff member
- Operational date
- Exception type
- Status
- Primary effective event or correction lineage identifier
- Related effective event identifiers where needed
- Detection revision
- Suggested resolution timestamp where reliable
- Created timestamp and source
- Reviewing manager and review start time
- Resolution correction batch where applicable
- Resolution reason and timestamp
- Dismissal reason and timestamp

No organisation or location placeholder columns are added.

An open-exception uniqueness key is based on staff, operational date, exception type, and stable anomaly fingerprint. Reconciliation uses `insert ... on conflict` or an equivalent conditional insert so repeated runs cannot duplicate an issue.

Resolved or dismissed exceptions remain immutable audit history. A newly observed anomaly with a different fingerprint creates a new exception.

### Reconciliation

`reconcile_attendance_exceptions(...)` is a separate write operation:

- It receives or determines a bounded staff/date scope.
- It holds the per-staff advisory lock.
- It re-derives anomaly candidates from effective events.
- It idempotently creates missing open exceptions.
- It never modifies original events or correction chains.
- It returns exact created, existing, and skipped counts.

Kiosk `start_new_shift` performs reconciliation inside its write transaction before creating today’s event. Pure state checks never write.

## Kiosk Transaction

### Request

```ts
type PerformAttendanceActionInput = {
  staffId: string;
  action: AttendanceAction;
  expectedRevision: string;
  idempotencyKey: string;
};
```

The device token and PIN remain separate authenticated inputs to the narrowly scoped database function. Neither is stored in idempotency records.

### Processing order

1. Validate the registered kiosk device.
2. Validate staff availability and PIN protections.
3. Validate UUID-form idempotency key.
4. Acquire the existing per-staff advisory transaction lock.
5. Look up the idempotency key.
6. Return the stored response when staff and action match.
7. Reject reuse for a different staff member or action.
8. Derive the latest authoritative state and revision.
9. Reject stale revisions or invalid transitions with the latest state.
10. Reconcile required stale exceptions for `start_new_shift`.
11. Insert one server-timestamped kiosk event where permitted.
12. Persist the complete safe result and resulting event reference.
13. Return the stored result.

### Transition rules

| State | Action | Result |
|---|---|---|
| `clocked_out` | `clock_in` | Insert current-day `clock_in` |
| `clocked_in` | `clock_out` | Insert current-day `clock_out` |
| `missing_clock_out` | `start_new_shift` | Create or reuse exception, then insert a new current-day `clock_in` |
| Any incompatible state | Any action | No event, return latest state |

Repeated clock-in and repeated clock-out requests are harmless invalid transitions. They return the authoritative state and create no event.

## Idempotency

### `attendance_action_requests`

The table stores:

- Client-generated UUID primary key
- Staff member
- Requested action
- Kiosk device identifier
- Expected revision
- Request creation and completion timestamps
- Safe result code
- Resulting state
- Resulting event identifier when present
- Safe JSON response required to reproduce the result
- Expiry timestamp

It never stores a PIN, PIN hash, candidate PIN, failed PIN comparison, or authentication secret.

The whole attendance mutation and result persistence occur in one transaction. A retry with the same UUID returns the original result. Reuse with a different staff member, action, or device is rejected.

Completed request records are retained for 90 days. Cleanup is a manager or maintenance operation that deletes only expired completed records. Cleanup is not required for correctness and must not run inside kiosk transactions.

## Manager Workflow

The existing attendance page gains an issues view rather than a disconnected subsystem. It supports filters for open, under review, resolved, dismissed, staff, date range, and exception type.

Each issue shows:

- Staff member and operational date
- Original immutable events
- Effective corrected events
- Rota context
- Suggested resolution, clearly labelled as a suggestion
- Type, status, age, and history

Manager resolution must:

1. Require manager authentication.
2. Require a reason of at least five characters.
3. Lock the staff attendance stream.
4. Validate the expected attendance revision.
5. Use the existing correction-chain functions to add, replace, or exclude effective events.
6. Link the correction batch to the exception.
7. Mark the exception resolved in the same transaction.

Dismissal requires a manager reason and is retained in the audit history. It does not modify attendance evidence.

The outdated direct `clock_events` insert action is removed and replaced with correction-chain RPC calls.

## Kiosk Experience

After successful PIN verification, the kiosk displays:

- Staff name
- Current local time
- Current state
- Relevant effective clock time
- Explicit next action
- Older unresolved warning where applicable
- Cancel

For `missing_clock_out`, the kiosk states that the previous shift needs manager review and that starting today does not close the previous shift. The primary action is “Start today’s shift”.

The PIN is cleared after every terminal attempt and after reset. Buttons are disabled while requests are pending. Touch targets remain at least 44 CSS pixels, with primary kiosk actions substantially larger.

Success displays the authoritative recorded time, duration for a completed valid shift, and whether an older shift was sent for manager review.

Errors use safe codes and copy for network failure, invalid transition, stale state, duplicate request conflict, inactive device, unavailable staff, and server failure. Internal identifiers and Supabase errors are not exposed.

## Rota and Leave Context

Rota and leave records provide warnings only:

- Scheduled start passed without a clock-in
- Clock-in significantly before scheduled start
- Clock-out significantly after scheduled finish
- Clock-in without a scheduled shift
- Clock-in during approved leave
- Unusually long current shift

Scheduled times may be suggested to managers but are never inserted automatically. Central defaults are five minutes for late arrival and 15 minutes for extended shift, matching existing behaviour where practical.

## Payroll and Hours Safety

All production attendance hours are calculated from effective events partitioned by staff and operational date.

Within each partition:

- Valid `clock_in` followed by `clock_out` contributes the elapsed duration.
- Pairing never crosses an operational day.
- Consecutive clock-ins, unmatched clock-outs, overlaps, and incomplete sequences contribute no invented duration for the affected pair.
- Valid independent pairs on the same day continue to contribute.
- Manager-approved effective corrections are used.
- Original values remain available for audit.

Weekly hours and staff history use the same day-partitioned pairing service.

Payroll readiness includes unresolved attendance exceptions. The existing explicit manager acknowledgement for unreviewed export remains available to avoid breaking current operations, but the exported workbook must prominently report unresolved exception counts and excluded malformed hours.

No locked payroll record or historical event is rewritten automatically.

## Historical Comparison and Backfill

### Diagnostic phase

Before creating historical exceptions, run a read-only production report which lists or securely identifies:

- Previous-day open sessions
- Consecutive clock-ins
- Unmatched clock-outs
- Overlapping attendance
- Shifts over 12 hours
- Events lacking expected device context
- Old pairing minutes and new operational-day pairing minutes

The comparison must explicitly cover the three audited consecutive clock-ins, five unmatched clock-outs, and nine adjacent pairs over 12 hours. It reports every staff/date total that would change.

### Controlled backfill

After manager review:

- Run an idempotent bounded backfill.
- Preserve all original events and corrections.
- Create open exceptions only for confirmed anomaly candidates.
- Do not resolve or dismiss anything automatically.
- Return exact created, already-existing, and skipped counts.
- Retain the diagnostic output with rollout records.

## Dashboard and Observability

The manager dashboard shows:

- Unresolved attendance issue count linked to the issues filter
- Valid current-day clocked-in staff
- Current sessions exceeding the warning threshold
- Recent unresolved issue summaries

Structured server logging records:

- Invalid transitions
- Revision or state conflicts
- Idempotent retries and key misuse
- Exception creation
- Failed manager resolutions
- Payroll exports with unresolved issues

Logs contain staff and event identifiers only where the existing server logging policy permits. They never contain PINs, PIN hashes, candidate PINs, pay rates, or salary values.

## Security Model

### Tables

Every new table in `public` has RLS enabled. Direct anonymous writes are revoked. Kiosk clients do not receive direct insert, update, or delete grants on attendance tables.

Managers may read exceptions through authenticated manager policies or narrowly scoped RPCs. Ordinary staff cannot edit attendance events, corrections, exceptions, or idempotency records.

### Functions

Pure derivation functions should be `SECURITY INVOKER` where their caller can safely read the required data. Functions that must serve an anonymous registered kiosk require `SECURITY DEFINER` because they cross RLS boundaries.

Every `SECURITY DEFINER` function:

- Pins `search_path` to required schemas.
- Fully qualifies relations.
- Performs device, role, staff, and input validation internally.
- Has `EXECUTE` revoked from `PUBLIC`.
- Is granted only to the required `anon` or `authenticated` role.
- Returns no PIN hash, pay field, correction reason not needed by the kiosk, or private manager data.

Direct security tests cover anonymous unregistered clients, registered kiosk clients, authenticated staff, authenticated managers, and prohibited direct table writes.

## Single-Organisation Limitation

The current production schema has no organisation or location ownership columns. This implementation must not claim tenant or location isolation and must not add nullable placeholders that imply security.

Organisation, location, membership, device assignment, and ownership-based RLS are prerequisites before external SaaS customers are onboarded. The new tables use stable primary keys and staff/device references so a later mandatory ownership migration can be performed deliberately.

## Compatibility and Rollout

Schema additions must coexist with the current application during a rolling deployment:

- Existing kiosk functions remain callable until the application is deployed.
- New functions and tables are additive before old function behaviour is replaced.
- Replaced RPC signatures are coordinated with the application deployment.
- Existing immutable events, correction chains, and reviews remain readable.
- Demo functionality is unchanged.

Rollout order:

1. Back up production and confirm restore readiness.
2. Reconcile and verify the five production migrations locally.
3. Build a fresh test database from repository migrations.
4. Run read-only attendance and payroll comparison diagnostics.
5. Review malformed production sequences.
6. Apply additive schema migration.
7. Deploy server and kiosk changes.
8. Verify representative normal, stale, duplicate, and corrected states.
9. Run controlled exception backfill.
10. Verify attendance issue counts and payroll totals.
11. Monitor conflicts, retries, exception creation, and export warnings.

Rollback:

- Redeploy the previous application while additive tables and functions remain.
- Restore previous kiosk function definitions if an RPC-compatible rollback is required.
- Do not delete new exception or idempotency audit records during emergency rollback.
- Do not reverse correction-chain entries or mutate original clock events.
- Drop additive objects only in a later reviewed cleanup migration after data retention decisions.

## Test Strategy

### Pure state tests

- No open event produces `clocked_out`.
- Valid current-day open event produces `clocked_in`.
- Previous local-day open event produces `missing_clock_out`.
- UTC date change without London date change does not make a shift stale.
- March and October UK daylight-saving transitions use the correct operational date.
- Consecutive clock-ins produce review state.
- Unmatched clock-out produces missing-clock-in state.
- Multiple malformed events produce manager-review state.
- Valid current shift is not blocked by resolved or older unresolved exceptions.
- Active corrections, exclusions, replacements, and supersession affect state deterministically.

### Transition and concurrency tests

- Clock-in creates one event.
- Clock-out closes only the current operational-day shift.
- Starting today creates a new event without changing yesterday’s event.
- Duplicate clock-in and clock-out create no event.
- Two concurrent clock-ins create at most one event.
- Retried UUID returns its stored result.
- UUID reuse with different input is rejected.
- Concurrent manager correction causes a clean state conflict or serialised valid result.
- Invalid transition returns latest state and allowed actions.

### Payroll and compatibility tests

- Pairing never crosses operational days.
- Malformed sequences contribute no invented hours.
- Corrected effective pairs contribute approved corrected duration.
- Existing valid event pairs retain their totals.
- Weekly hours remain correct.
- Staff attendance history remains read-only.
- Unresolved issues appear in payroll readiness and export warnings.
- Old and new production totals are compared without rewriting history.

### Database and security tests

- Fresh migration replay matches production correction architecture.
- New tables have RLS enabled.
- Anonymous direct writes fail.
- Authenticated staff direct writes fail.
- Registered kiosk can invoke only approved kiosk functions.
- Managers can resolve through correction functions.
- Non-managers cannot resolve, dismiss, or enumerate manager-only issue data.
- Function grants, revocations, and pinned search paths match the specification.

### Full verification

Run:

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Database migration replay, RPC integration tests, RLS tests, and diagnostic comparison are also required. The work must not be described as production-ready unless every applicable verification passes.

## Acceptance Criteria

- Yesterday’s unmatched clock-in cannot become today’s clock-out.
- Starting today does not modify or close yesterday’s event.
- State derivation is deterministic and correction-aware.
- State reads do not create exceptions.
- Exception reconciliation is idempotent.
- Two concurrent clock-ins create at most one event.
- Retried requests return the original result.
- Corrections concurrent with kiosk actions cannot corrupt ordering.
- Payroll never pairs events across operational days.
- No clock-out time is fabricated.
- Manager resolution uses the immutable correction chain with identity, reason, and revision.
- Existing valid attendance, PIN lockout, weekly hours, history, rota, leave, and payroll workflows remain functional.
- The repository can build the correction workflow from a fresh database.
- Production migration history and repository history are reconciled exactly.
- RLS and direct-write denial are tested for each actor.
- Lint, type checking, all automated tests, build, and database verification pass.

## Remaining Prerequisites and Follow-up

- Multi-organisation and multi-location ownership are not implemented and remain a prerequisite for external SaaS onboarding.
- Genuine overnight shifts require a future configurable operational rollover rule.
- Automated idempotency cleanup requires an approved maintenance scheduler or documented manual runbook.
- Email, SMS, and push notifications remain out of scope.
