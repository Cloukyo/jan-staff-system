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
8. Server time is authoritative for online kiosk events. Offline evidence preserves device and server times and is accepted only after server validation.
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
  | "unusually_long_shift"
  | "offline_sync_conflict"
  | "device_clock_drift"
  | "offline_time_uncertain";
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
  offlineEvidence?: {
    authorisationId: string;
    occurredAtDevice: string;
    deviceTimezone: string;
    deviceSequence: number;
    trustedSnapshotRevision: string;
    rosterVersion: string;
    signature: string;
  };
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
11. Insert one event where permitted. Online events use server time. Accepted offline events preserve the validated device occurrence time and server receipt time.
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
- Offline authorisation and device sequence where applicable
- Device occurrence time, server receipt time, clock-confidence result, and conflict category where applicable

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

## Offline-Resilient Kiosk

### Authority boundary

The server-side effective attendance ledger remains the sole attendance authority. IndexedDB records are provisional requests and trusted-state snapshots. They are never clock events and never affect payroll until the server accepts them through the normal attendance action transaction.

The client never inserts or synchronises rows directly into `clock_events`, `clock_event_corrections`, `attendance_exceptions`, or `attendance_action_requests`.

### Progressive Web App shell

The production `/clock` experience is installable and can reopen after a previously authorised online setup. A deliberately scoped service worker caches:

- The `/clock` application shell
- The manifest, kiosk icons, font assets, and required Next.js chunks
- Version metadata required to reject incompatible queue formats

It does not broadly cache:

- Manager routes
- Authenticated manager responses
- Payroll, compliance, leave, or staff-profile data
- Supabase REST or RPC responses
- PIN submissions or server errors

The `/clock` document uses network-first with the last compatible shell as fallback. Immutable build assets use cache-first with versioned URLs. Obsolete shell caches are deleted only after the active client and queue schema are confirmed compatible.

Background Sync is an optional enhancement. Correctness relies on foreground sync at application launch, browser `online` events, visibility regain, periodic retry while open, and the manual “Sync now” action.

### Offline eligibility

New offline actions are accepted locally only when all conditions are true:

1. The device previously completed an online registered-kiosk session.
2. The current device registration is represented by a trusted local authorisation package.
3. A complete roster version was atomically stored.
4. The selected staff member has a current device-specific offline PIN verifier.
5. The authorisation has not passed its server-issued expiry.
6. At least one full online synchronisation completed for the current authorisation.
7. The trusted staff state is unambiguous or explicitly permits `start_new_shift`.
8. The per-device offline feature flag is enabled.

The default offline-authorisation lifetime is 24 hours. The server-issued expiry is authoritative. The client applies the expiry conservatively while disconnected. Expiry prevents new offline actions but does not delete queued actions, receipts, or diagnostic data.

A cached but unregistered device can display only the setup-required or expired shell. It cannot access a roster, verify a PIN, or queue attendance.

### Minimal roster

The atomic offline roster snapshot contains only:

- Stable staff identifier
- Display name
- Approved kiosk avatar reference when already supported
- Offline verifier envelope
- Roster version
- Authorisation identifier and expiry
- Registered device identifier
- Trusted attendance state and revision

It excludes full names where the display name is sufficient, contact information, addresses, DBS information, qualifications, payroll data, leave documents, manager details, and credentials.

A new roster is written in one IndexedDB transaction and becomes active only after all entries and metadata validate. The previous complete version remains active if refresh fails.

### Device-bound offline PIN verifier

The production bcrypt PIN hash is never exposed to the kiosk.

Offline verification uses a separately enrolled, device-specific verifier:

1. The registered browser generates a non-extractable Web Crypto signing key and a non-extractable verifier key.
2. The public signing key is registered with the server for that kiosk authorisation.
3. After a successful online server PIN verification, the browser derives a slow PIN value using PBKDF2-SHA-256 with a per-staff, per-authorisation random salt and a centrally defined high iteration count.
4. The browser authenticates the derived value with the non-extractable device verifier key.
5. It stores only the salt, parameters, authenticated verifier, staff ID, authorisation version, and expiry.
6. Offline candidates repeat the derivation and constant-time comparison.

Online PIN use remains unchanged. Offline enrolment never stores the submitted PIN and clears all PIN state immediately.

Offline enrolment requires a six-digit PIN because four-digit space is not sufficient against offline guessing. Staff who retain a four- or five-digit PIN can continue online clocking but cannot be marked offline-ready until they choose a six-digit PIN.

The local policy permits three failed offline attempts per staff and authorisation. The fourth attempt locks offline verification until the device reconnects successfully. Lockout state is authenticated with the device verifier key so ordinary IndexedDB editing is detected.

This design reduces casual IndexedDB copying and offline guessing risk but cannot make a browser PWA tamper-proof. An attacker with physical control, developer tools, and the ability to execute code in the kiosk origin may be able to invoke non-extractable keys or bypass client-side rate limiting. Client-side encryption does not remove this residual because its key is available to the running origin. The 24-hour expiry, six-digit requirement, device revocation, kiosk OS restrictions, and staged hardware testing are mandatory compensating controls.

Full offline clocking must not be enabled or described as complete if the actual kiosk browser cannot persist non-extractable keys reliably across restart or cannot enforce an acceptable managed-device posture. In that case the PWA shell and queue remain available for diagnostics, but managers use the documented manual attendance procedure during outages.

### IndexedDB stores

The versioned database contains:

- `metadata`: schema version, active roster version, authorisation, trusted clock anchor, and last sync
- `rosters`: complete inactive and active roster snapshots
- `trustedStates`: immutable last server state and revision per staff
- `pinVerifiers`: device-specific verifier envelopes and expiry
- `pinLockouts`: authenticated failed-attempt state
- `pendingActions`: provisional signed action requests
- `syncReceipts`: definitive server responses retained after queue completion
- `localAudit`: authorised discard and recovery operations

All updates which move an action between states or activate a roster use one IndexedDB transaction. A queue migration must either complete atomically or leave the previous schema usable. An incompatible application update displays a sync-required error and preserves data.

No ordinary `localStorage` is used.

### Pending action

```ts
type PendingAttendanceAction = {
  schemaVersion: number;
  idempotencyKey: string;
  authorisationId: string;
  rosterVersion: string;
  deviceId: string;
  staffId: string;
  action: AttendanceAction;
  occurredAtDevice: string;
  deviceTimezone: string;
  operationalDateAtDevice: string;
  deviceSequence: number;
  queueCreatedAt: string;
  trustedSnapshotRevision: string;
  priorPendingActionId: string | null;
  unresolvedOlderException: boolean;
  status: "pending" | "syncing" | "synced" | "conflicted" | "rejected";
  retryCount: number;
  lastErrorCategory: string | null;
  signature: string;
};
```

The entered PIN is absent. Every retry uses the same UUID and signed payload.

### Device signature and server route

The device signs the canonical action payload with its non-extractable private signing key. Copying a queue row to another device does not copy an exportable signing credential.

A same-origin server route receives queued actions, reads the HttpOnly registered-device cookie, validates the device signature against the registered public key, checks authorisation version and expiry, and calls the narrowly scoped database action transaction. The offline database RPC is not directly granted to `anon` or `authenticated`; only the server boundary may invoke it.

Signature verification proves that the registered browser key signed the payload. It does not independently prove that trustworthy kiosk code performed the local PIN comparison. The managed-device and short-expiry controls therefore remain part of the security boundary.

### Provisional local state

The kiosk rebuilds each staff member’s provisional state from:

1. The immutable last trusted server snapshot
2. That staff member’s queued actions ordered by sequence, occurrence time, and queue creation time

It never edits the trusted snapshot. Provisional state and hours are labelled “Pending synchronisation” and are not described as confirmed or payroll-ready.

If the trusted snapshot was stale, ambiguous, or awaiting review, the local projection exposes only actions explicitly safe in the snapshot. A known old missing clock-out may permit `start_new_shift`. It never turns an ambiguous state into a generic toggle.

No trustworthy snapshot means no offline action.

### Device and server timestamps

Offline evidence preserves:

- `occurred_at_device`: the unmodified wall-clock time shown when the action was queued
- `received_at_server`: the server time at definitive receipt
- Trusted server time and device wall-clock anchor from the last sync
- Monotonic elapsed time where the browser session provides it
- Device timezone and operational date claimed by the client

The server validates:

- Occurrence within the authorisation window
- Named device timezone and London operational date
- Device sequence monotonicity
- Future timestamps
- Reordering within one staff stream
- Timestamp earlier than the last trusted contact where suspicious
- Wall-clock movement inconsistent with available monotonic time
- Difference from an estimated trusted time anchor

The initial acceptable drift threshold is five minutes. A larger or unverifiable drift produces `device_clock_drift` or `offline_time_uncertain` conflict evidence rather than a normal event. An offline delay between occurrence and receipt is not itself clock drift.

Accepted offline events use the validated `occurred_at_device` as `event_timestamp` and store `received_at_server`, device sequence, authorisation, and drift assessment as immutable audit metadata. The server never silently rewrites the submitted occurrence time.

### Synchronisation

Queue order is deterministic by device sequence, device occurrence time, and queue creation time. Actions are serial within each staff member. Different staff streams may progress independently, but the initial implementation may use a single deterministic worker for simplicity.

For each item:

1. Persist `syncing` without deleting the row.
2. POST the original signed payload and UUID.
3. Let the server verify device, authorisation, payload, revision, state, corrections, and permissions under the staff advisory lock.
4. Persist the definitive receipt and new trusted snapshot in one local transaction.
5. Mark the queue item definitive.
6. Remove the pending payload only after the receipt is durable.

If a timeout occurs after server acceptance, the unchanged UUID returns the stored server result on retry. Background Sync firing twice cannot create a second event.

Completed receipts are retained for 30 days. Definitive queue payloads are retained for seven days before removal. Pending, conflicted, and indeterminate items are never removed by routine cleanup.

### Server outcomes

```ts
type OfflineSyncOutcome =
  | "synced"
  | "already_processed"
  | "unauthorised"
  | "conflicted"
  | "retryable_failure"
  | "permanently_invalid";
```

An action conflicting with another kiosk event, a manager correction, changed revision, removed roster entry, revoked device, expired authorisation, reordered sequence, or uncertain time is preserved in the action request. Where attendance evidence requires review, an `offline_sync_conflict` source exception is created idempotently. It does not create a normal event or payroll time.

Manager resolution uses the existing correction chain and displays requested action, occurrence time, receipt time, device, conflict reason, and relevant effective ledger.

### Connectivity and user interface

The kiosk status is always one of:

- Online
- Offline: clockings will sync later
- Synchronising
- Sync problem
- Offline authorisation expired

`navigator.onLine` is only one signal. A lightweight server reachability check determines confirmed connectivity.

The offline notice reads:

> Internet connection lost. Clockings recorded on this device will be marked as pending and synchronised when the connection returns.

Offline confirmation reads:

> Clock-in saved on this device at 8:57 AM. Pending synchronisation.

or:

> Clock-out saved on this device at 5:04 PM. Pending synchronisation.

The screen shows pending count, oldest pending age, last successful sync, “Sync now”, and conflicts requiring manager review. It never uses normal online success styling for a local-only action.

### Safe reset and recovery

Manager logout, kiosk deregistration, reset, or local-data clearing checks for non-definitive actions. Ordinary reset cannot delete them.

Destructive discard requires online manager authentication where possible, an explicit reason, a diagnostic export, and local audit. The server records the discard when reachable. Deregistration immediately prevents new offline actions but retains the queue for support recovery.

### Device health

The manager device view shows last contact, last roster refresh, authorisation expiry, last reported pending count, oldest pending age, last sync failure, clock-drift warning, offline feature flag, and revocation control.

An offline device can report only its last known queue health. The manager UI labels unknown final queue state honestly.

### Browser and hardware gate

The baseline must work without Background Sync:

- Installed iPad Home Screen PWA and Safari use launch, visibility, online-event, periodic foreground, and manual sync.
- Chrome or Android installed PWA may additionally use Background Sync.
- Ordinary browser mode uses the same foreground mechanisms but may have less predictable storage retention.

The actual Jan Preschool tablet model, operating-system version, browser, storage-retention behaviour, private-key persistence, installed-PWA mode, and device-management restrictions are not recorded in the repository. Offline clocking remains disabled by default until these are tested on the physical device for browser restart, tablet restart, storage pressure, service-worker update, network loss, and clock change.

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

Pending local actions never affect payroll. Accepted offline actions contribute exactly once using their accepted occurrence time. Conflicted actions contribute nothing until manager resolution.

Payroll readiness also includes unresolved offline synchronisation conflicts, last reported pending queue counts, and recently offline devices whose final queue state is unknown. The application must not claim attendance is complete solely because normal server exceptions are clear when an offline-enabled kiosk may still hold unsynchronised evidence.

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

Offline telemetry additionally records safe device identifiers, queue counts, sync outcomes, conflict categories, clock-drift classifications, authorisation expiry, and authorised discard. It never records verifier material, device private keys, entered PINs, full signed payloads, or cached roster contents.

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

Offline security tests also cover an unregistered cached shell, expired authorisation, revoked device, changed device identifier, invalid device signature, replayed UUID, altered payload, verifier expiry, local lockout, queue tampering, and server-route denial of direct database mutation.

Browser storage encryption and non-extractable keys are defence against casual extraction, not a claim of resistance to a fully compromised browser origin. Physical device management, short authorisation lifetime, six-digit offline PINs, revocation, and real-device testing are required controls.

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
- Offline capability is disabled by default and enabled per registered device only after provisioning and hardware validation.
- Service-worker and IndexedDB schema versions remain compatible with retained queued evidence.

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
11. Deploy the offline shell with offline clocking disabled.
12. Provision and test one physical kiosk device.
13. Enable offline clocking for that device only.
14. Run a complete operational-period pilot with observed clockings.
15. Monitor conflicts, retries, exception creation, queue health, drift, and export warnings.

Rollback:

- Redeploy the previous application while additive tables and functions remain.
- Restore previous kiosk function definitions if an RPC-compatible rollback is required.
- Do not delete new exception or idempotency audit records during emergency rollback.
- Do not reverse correction-chain entries or mutate original clock events.
- Drop additive objects only in a later reviewed cleanup migration after data retention decisions.
- Do not unregister the service worker or clear IndexedDB while pending or conflicted evidence remains.
- Disable the per-device offline feature flag to stop new offline actions without destroying queued evidence.

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

### Offline queue tests

- Offline clock-in and clock-out create explicit pending actions.
- Multiple staff queues preserve each staff stream.
- Queue survives reload, browser restart simulation, service-worker restart, and schema upgrade.
- PIN values never enter IndexedDB.
- Trusted snapshots remain immutable while provisional state changes.
- Local confirmation is labelled pending.
- Expired or absent authorisation blocks new queue items and preserves existing ones.

### Offline synchronisation tests

- Reconnect, app launch, visibility regain, periodic retry, and manual sync invoke the same worker.
- Background Sync absence does not prevent foreground synchronisation.
- Background Sync repetition remains idempotent.
- Network loss midway leaves the item recoverable.
- Server acceptance followed by client timeout returns the original receipt.
- Per-staff actions remain ordered.
- Different staff streams do not reorder within a staff member.
- Queue items are removed only after a durable local receipt.

### Offline conflict and security tests

- Another kiosk action, manager correction, changed revision, removed staff, revoked device, expired authorisation, bad clock, duplicate UUID, changed payload, and older unresolved shift all return explicit outcomes.
- Conflict evidence is retained and excluded from payroll.
- Three offline PIN failures lead to local lockout before another comparison.
- Production PIN hashes are never returned or stored.
- Changed device identifier or invalid signature is rejected.
- An unregistered cached kiosk cannot become offline-capable.
- Authorised local discard requires manager evidence and preserves diagnostic output.
- Device and server timestamps remain separately auditable.

### Payroll and compatibility tests

- Pairing never crosses operational days.
- Malformed sequences contribute no invented hours.
- Corrected effective pairs contribute approved corrected duration.
- Existing valid event pairs retain their totals.
- Weekly hours remain correct.
- Staff attendance history remains read-only.
- Unresolved issues appear in payroll readiness and export warnings.
- Old and new production totals are compared without rewriting history.
- Pending offline actions do not affect payroll.
- Accepted offline evidence affects payroll once.
- Offline conflicts and unknown device queue state appear in payroll readiness.

### Database and security tests

- Fresh migration replay matches production correction architecture.
- New tables have RLS enabled.
- Anonymous direct writes fail.
- Authenticated staff direct writes fail.
- Registered kiosk can invoke only approved kiosk functions.
- Managers can resolve through correction functions.
- Non-managers cannot resolve, dismiss, or enumerate manager-only issue data.
- Function grants, revocations, and pinned search paths match the specification.
- The offline sync database RPC is not directly executable by public browser roles.
- The same-origin sync route validates the registered-device cookie, signature, authorisation, and payload.

### Full verification

Run:

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Database migration replay, RPC integration tests, RLS tests, and diagnostic comparison are also required. The work must not be described as production-ready unless every applicable verification passes.

Service-worker scope, cache inventory, IndexedDB recovery, offline tests with Background Sync present and absent, and tests on the real Jan Preschool device are also required before offline clocking is enabled.

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
- A previously authorised kiosk shell loads during an outage.
- Secure offline PIN enrolment and verification use no production PIN hash or plaintext storage.
- Pending actions survive reloads and restarts on tested kiosk hardware.
- Every offline action retains one UUID across all retries.
- Sync uses the normal state machine, locking, correction awareness, operational-day rules, and idempotency.
- Conflicts are retained and manager-visible.
- Local-only actions are visibly pending and excluded from payroll.
- Offline clocking remains disabled for devices which have not passed hardware validation.

## Remaining Prerequisites and Follow-up

- Multi-organisation and multi-location ownership are not implemented and remain a prerequisite for external SaaS onboarding.
- Genuine overnight shifts require a future configurable operational rollover rule.
- Automated idempotency cleanup requires an approved maintenance scheduler or documented manual runbook.
- Email, SMS, and push notifications remain out of scope.
- A browser PWA cannot fully resist a physically controlled attacker with same-origin code execution. Managed-device controls remain necessary.
- Actual Jan Preschool kiosk hardware and browser details must be recorded and tested before offline enablement.
