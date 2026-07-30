# Attendance State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace latest-event attendance toggling with a correction-aware, operational-day state machine that preserves immutable evidence, records explicit exceptions, prevents duplicate actions, and excludes malformed attendance from payroll.

**Architecture:** Production attendance remains an immutable effective-event ledger built from `clock_events` and `clock_event_corrections`. PostgreSQL functions own authoritative state derivation, locking, idempotency, and kiosk mutations; focused TypeScript domain functions own deterministic presentation and payroll pairing of database-returned effective events. The kiosk PWA stores only provisional signed requests and trusted snapshots in IndexedDB, then synchronises through the same server transaction. New exception, request, offline-authorisation, and device-health tables are additive and RLS-protected.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest 4, Supabase/PostgreSQL 17, PL/pgSQL, date-fns 4

## Global Constraints

- Use UK date, time and currency formats.
- Use the `Europe/London` timezone and local-midnight operational boundary.
- Preserve original `clock_events`; manager corrections remain separate.
- Do not fabricate clock-in or clock-out timestamps.
- Do not calculate tax, PAYE, National Insurance, pensions or payslips.
- Do not expose pay, salary, PIN, PIN-hash, or manager-only information on the kiosk.
- Do not allow staff to edit their attendance.
- Do not add placeholder organisation or location ownership columns.
- Keep the production deployment explicitly single-organisation and single-location.
- Do not remove demo functionality.
- Do not use em dashes in user-facing application copy.
- Do not use `localStorage` for offline kiosk authority, roster, PIN verifiers, queues, receipts, or trusted state.
- Do not expose production PIN hashes or store plaintext PINs offline.
- Pending and conflicted offline actions do not affect payroll.
- Offline clocking is disabled by default and enabled only per tested registered device.
- Use test-first red-green-refactor cycles for every feature or bug fix.
- Do not describe the change as production-ready unless lint, typecheck, tests, build, migration replay, RPC tests, RLS tests, and production diagnostics pass.

---

## File Structure

### Historical reconciliation

- Create `supabase/migrations/20260723162038_staff_lifecycle_management.sql`
- Create `supabase/migrations/20260723162052_enforce_staff_lifecycle_paths.sql`
- Create `supabase/migrations/20260728230702_clock_event_corrections.sql`
- Create `supabase/migrations/20260728230820_revoke_clock_correction_trigger_execute.sql`
- Create `supabase/migrations/20260729015320_attendance_remove_and_reset.sql`
- Create `tests/migration-history.test.ts`

### Attendance domain and persistence

- Create `src/lib/attendance/state-machine.ts`
- Create `src/lib/attendance/pairing.ts`
- Create `src/lib/attendance/types.ts`
- Create `src/lib/attendance/exceptions-server.ts`
- Create the CLI-generated `supabase/migrations/*_attendance_state_machine.sql` file and record its exact generated name in the task checklist
- Create `supabase/tests/attendance_state_machine.sql`
- Create `tests/attendance-state-machine.test.ts`
- Create `tests/attendance-pairing.test.ts`

### Kiosk

- Modify `src/lib/kiosk/types.ts`
- Modify `src/lib/kiosk/security.ts`
- Modify `src/lib/kiosk/actions.ts`
- Modify `src/lib/kiosk/server.ts`
- Modify `src/components/kiosk/production-kiosk.tsx`
- Create `src/lib/kiosk/presentation.ts`
- Create `tests/kiosk-state-machine.test.ts`

### Offline kiosk PWA

- Create `src/app/manifest.ts`
- Create `public/sw.js`
- Create `src/components/kiosk/service-worker-registration.tsx`
- Create `src/lib/kiosk/offline/types.ts`
- Create `src/lib/kiosk/offline/database.ts`
- Create `src/lib/kiosk/offline/crypto.ts`
- Create `src/lib/kiosk/offline/projection.ts`
- Create `src/lib/kiosk/offline/queue.ts`
- Create `src/lib/kiosk/offline/sync.ts`
- Create `src/lib/kiosk/offline/connectivity.ts`
- Create `src/app/api/kiosk/offline/provision/route.ts`
- Create `src/app/api/kiosk/offline/sync/route.ts`
- Create `src/app/api/kiosk/offline/health/route.ts`
- Create the CLI-generated `supabase/migrations/*_offline_kiosk_attendance.sql` file and record its exact generated name in the task checklist
- Modify `package.json`
- Modify `package-lock.json`
- Create `tests/offline-kiosk-database.test.ts`
- Create `tests/offline-kiosk-pin.test.ts`
- Create `tests/offline-kiosk-sync.test.ts`
- Create `tests/offline-kiosk-service-worker.test.ts`
- Create `tests/offline-kiosk-server.test.ts`

### Manager attendance

- Modify `src/lib/attendance/review-server.ts`
- Modify `src/lib/attendance/review-actions.ts`
- Modify `src/components/attendance/attendance-review.tsx`
- Modify `src/components/attendance/production-attendance.tsx`
- Modify `src/app/attendance/page.tsx`
- Create `tests/attendance-exceptions.test.ts`

### Payroll, history, dashboard and diagnostics

- Modify `src/lib/payroll/types.ts`
- Modify `src/lib/payroll/server.ts`
- Modify `src/lib/payroll/calculations.ts`
- Modify `src/components/payroll/production-payroll-screen.tsx`
- Modify `src/app/payroll/export/route.ts`
- Modify `src/lib/staff-self-service/server.ts`
- Modify `src/lib/attendance/hours.ts`
- Modify `src/lib/dashboard/types.ts`
- Modify `src/lib/dashboard/server.ts`
- Modify `src/components/dashboard/production-dashboard.tsx`
- Create `scripts/attendance-diagnostics.sql`
- Create `scripts/attendance-payroll-comparison.sql`
- Create `docs/attendance-state-machine-rollout.md`
- Modify relevant existing tests and create `tests/attendance-diagnostics.test.ts`

---

### Task 1: Reconcile the Exact Production Migration History

**Files:**

- Create: the five historical migration files listed above
- Create: `tests/migration-history.test.ts`

**Interfaces:**

- Consumes: authoritative rows from `supabase_migrations.schema_migrations`
- Produces: a repository migration chain that exactly matches the five production-applied versions

- [ ] **Step 1: Write the failing migration-integrity test**

Create a table-driven test that hashes UTF-8 file content after normalising only CRLF to LF:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const expected = [
  ["20260723162038_staff_lifecycle_management.sql", 2017, "f507abecf62cdc33fb2efceea1a886dfbfb7945d5e4e8fdb7a1c16468ebe270e"],
  ["20260723162052_enforce_staff_lifecycle_paths.sql", 2082, "2044620d93a564ec91147e0aaba77a3fbf6babc94d492f29eeceef931ec5a192"],
  ["20260728230702_clock_event_corrections.sql", 53927, "4da94c144921995e435a50c941ac45c7994770876ed394e871646925d86d950d"],
  ["20260728230820_revoke_clock_correction_trigger_execute.sql", 104, "a15be1be659fbb344a0d41fd6b3eaa15fac7e7c9953264f8e31da476ab0758c5"],
  ["20260729015320_attendance_remove_and_reset.sql", 13667, "a1c7bad1c4317e283c6447af054ca1a7a4bbc504bdab998fa770f75e36325d65"],
] as const;

describe("production migration history", () => {
  it.each(expected)("%s matches the production statement exactly", (file, bytes, sha256) => {
    const sql = readFileSync(resolve("supabase/migrations", file), "utf8").replaceAll("\r\n", "\n");
    expect(Buffer.byteLength(sql, "utf8")).toBe(bytes);
    expect(createHash("sha256").update(sql, "utf8").digest("hex")).toBe(sha256);
  });
});
```

The production change caught by this test is accidental or approximate modification of already-applied migration history.

- [ ] **Step 2: Run the test and verify RED**

Run:

```text
npm.cmd test -- tests/migration-history.test.ts
```

Expected: failure because all five files are absent.

- [ ] **Step 3: Recover the exact statements**

Read each authoritative statement independently so tool output is not truncated:

```sql
select version, name, statements[1]
from supabase_migrations.schema_migrations
where version in (
  '20260723162038',
  '20260723162052',
  '20260728230702',
  '20260728230820',
  '20260729015320'
)
order by version;
```

Create each migration file with the returned statement byte-for-byte using `apply_patch`. Do not regenerate SQL from `pg_get_functiondef`, schema inspection, or memory.

- [ ] **Step 4: Run the integrity test and verify GREEN**

Run:

```text
npm.cmd test -- tests/migration-history.test.ts
```

Expected: five passing cases with the exact production hashes.

- [ ] **Step 5: Verify production sees the versions as applied**

List production migrations and confirm all five version/name pairs occur exactly once. Do not apply the recovered files to production.

- [ ] **Step 6: Record the fresh-database verification gate**

Run `npx.cmd supabase --help` and `npx.cmd supabase db --help` before choosing commands. Because Docker is not currently installed, use either:

1. An approved Supabase development branch, or
2. A PostgreSQL 17 test database explicitly supplied by the user.

Do not use an unrelated existing project. If neither safe target is available, continue non-database implementation but mark migration replay and production readiness blocked.

- [ ] **Step 7: Commit**

```text
git add tests/migration-history.test.ts supabase/migrations/20260723162038_staff_lifecycle_management.sql supabase/migrations/20260723162052_enforce_staff_lifecycle_paths.sql supabase/migrations/20260728230702_clock_event_corrections.sql supabase/migrations/20260728230820_revoke_clock_correction_trigger_execute.sql supabase/migrations/20260729015320_attendance_remove_and_reset.sql
git commit -m "chore: reconcile production migration history"
```

### Task 2: Build Deterministic Operational-Day State Derivation

**Files:**

- Create: `src/lib/attendance/types.ts`
- Create: `src/lib/attendance/state-machine.ts`
- Test: `tests/attendance-state-machine.test.ts`

**Interfaces:**

- Produces:

```ts
export type AttendanceState =
  | "clocked_out"
  | "clocked_in"
  | "missing_clock_out"
  | "missing_clock_in"
  | "awaiting_manager_review";

export type AttendanceAction = "clock_in" | "clock_out" | "start_new_shift";

export type EffectiveAttendanceEvent = {
  eventId: string;
  eventOrderKey: string;
  originalEventId: string | null;
  correctionId: string | null;
  staffId: string;
  eventType: "clock_in" | "clock_out";
  eventTimestamp: string;
  source: "kiosk" | "legacy_manager" | "manager_correction";
};

export function attendanceOperationalDate(value: string | Date): string;
export function deriveAttendanceState(input: {
  staffId: string;
  evaluatedAt: string;
  events: EffectiveAttendanceEvent[];
  unresolvedExceptions?: AttendanceExceptionSummary[];
  maximumShiftMinutes?: number;
}): AttendanceStateResult;
```

- [ ] **Step 1: Write failing table-driven state tests**

Use literal fixtures for:

```ts
it.each([
  { name: "empty ledger", events: [], now: "2026-07-30T09:00:00+01:00", state: "clocked_out", actions: ["clock_in"] },
  { name: "current open shift", events: [event("clock_in", "2026-07-30T08:58:00+01:00")], now: "2026-07-30T09:00:00+01:00", state: "clocked_in", actions: ["clock_out"] },
  { name: "previous day open shift", events: [event("clock_in", "2026-07-29T08:58:00+01:00")], now: "2026-07-30T09:00:00+01:00", state: "missing_clock_out", actions: ["start_new_shift"] },
])("$name", ({ events, now, state, actions }) => {
  const result = deriveAttendanceState({ staffId: "staff-a", evaluatedAt: now, events });
  expect(result.state).toBe(state);
  expect(result.allowedActions).toEqual(actions);
});
```

Add independent tests for consecutive clock-ins, unmatched clock-out, multiple malformed events, current valid shift plus older exception, resolved exception, replacement correction, excluded event, and superseded correction output.

- [ ] **Step 2: Write failing timezone tests**

Assert literal London dates:

```ts
expect(attendanceOperationalDate("2026-03-29T00:30:00Z")).toBe("2026-03-29");
expect(attendanceOperationalDate("2026-03-29T23:30:00Z")).toBe("2026-03-30");
expect(attendanceOperationalDate("2026-10-25T00:30:00Z")).toBe("2026-10-25");
expect(attendanceOperationalDate("2026-07-29T23:30:00Z")).toBe("2026-07-30");
```

- [ ] **Step 3: Run tests and verify RED**

```text
npm.cmd test -- tests/attendance-state-machine.test.ts
```

Expected: module-not-found or missing-export failure.

- [ ] **Step 4: Implement the minimal domain types and state function**

Use `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })`. Partition events by operational date and scan each partition without pairing across dates.

Return a deterministic revision based on sorted effective event IDs, correction IDs, exception IDs/statuses, and evaluated operational date. Use SHA-256 only in the server/database boundary; the pure function may return a canonical revision input string for testing.

- [ ] **Step 5: Verify GREEN and refactor**

```text
npm.cmd test -- tests/attendance-state-machine.test.ts
```

Expected: all state and timezone cases pass.

- [ ] **Step 6: Commit**

```text
git add src/lib/attendance/types.ts src/lib/attendance/state-machine.ts tests/attendance-state-machine.test.ts
git commit -m "feat: derive operational attendance state"
```

### Task 3: Build Safe Operational-Day Pairing

**Files:**

- Create: `src/lib/attendance/pairing.ts`
- Test: `tests/attendance-pairing.test.ts`
- Modify: `src/lib/attendance/hours.ts`

**Interfaces:**

- Consumes: `EffectiveAttendanceEvent[]`
- Produces:

```ts
export type AttendanceDayPairing = {
  staffId: string;
  operationalDate: string;
  completedMinutes: number;
  pairs: Array<{ clockInId: string; clockOutId: string; minutes: number }>;
  anomalies: AttendanceExceptionType[];
};

export function pairAttendanceByOperationalDay(
  events: EffectiveAttendanceEvent[],
  maximumShiftMinutes?: number,
): AttendanceDayPairing[];
```

- [ ] **Step 1: Write failing pairing tests**

Cover:

- One valid same-day pair returns 480 minutes.
- A 29 July clock-in followed by a 30 July clock-out returns zero minutes on both days and reports missing/unmatched anomalies.
- Consecutive clock-ins followed by one clock-out do not invent a pair.
- An unmatched clock-out returns zero.
- Two independent valid pairs on the same day are summed.
- A valid pair over 12 hours contributes its actual duration but reports `unusually_long_shift`.

- [ ] **Step 2: Run and verify RED**

```text
npm.cmd test -- tests/attendance-pairing.test.ts
```

- [ ] **Step 3: Implement a strict per-day sequence scanner**

Only `clock_in, clock_out` adjacent states form a pair. On malformed input, record an anomaly and reset or retain state only according to the explicit table in the design. Never call `Math.max(0, crossDayDifference)`.

- [ ] **Step 4: Update weekly-hours helpers to consume pairings**

Replace the global open-event scanner in `summariseCompletedClockMinutes` with the operational-day pairer while preserving its current public result:

```ts
export type AttendanceHoursSummary = {
  completedMinutes: number;
  hasOpenShift: boolean;
  hasUnresolvedException: boolean;
};
```

- [ ] **Step 5: Verify GREEN and regression tests**

```text
npm.cmd test -- tests/attendance-pairing.test.ts tests/kiosk.test.ts
```

- [ ] **Step 6: Commit**

```text
git add src/lib/attendance/pairing.ts src/lib/attendance/hours.ts tests/attendance-pairing.test.ts tests/kiosk.test.ts
git commit -m "fix: pair attendance within operational days"
```

### Task 4: Add Exception, Idempotency and Authoritative Database Functions

**Files:**

- Create: the exact CLI-generated `supabase/migrations/*_attendance_state_machine.sql` file from Step 1
- Create: `supabase/tests/attendance_state_machine.sql`
- Modify: `tests/migration-history.test.ts` only if the new migration inventory needs a non-hash assertion

**Interfaces:**

- Produces database objects:

```sql
public.attendance_exceptions
public.attendance_action_requests
public.attendance_operational_date(timestamptz)
public.get_attendance_state(text, timestamptz)
public.reconcile_attendance_exceptions(text, date, date)
public.perform_device_kiosk_attendance_action(text, text, text, text, text, uuid)
public.resolve_attendance_exception(uuid, jsonb, text, text)
public.dismiss_attendance_exception(uuid, text, text)
public.get_effective_attendance_day_summaries(date, date, text)
```

- [ ] **Step 1: Generate the migration filename through the CLI**

Discover the command first:

```text
npx.cmd supabase migration new --help
```

Then run:

```text
npx.cmd supabase migration new attendance_state_machine
```

Use the generated filename. Do not invent a timestamp.

- [ ] **Step 2: Write failing SQL integration tests first**

Create a transaction-wrapped SQL test with an assertion helper:

```sql
create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not condition then raise exception 'assertion failed: %', message; end if;
end;
$$;
```

Fixtures must prove:

- State query is read-only and does not create exceptions.
- Previous-day clock-in returns `missing_clock_out`.
- `start_new_shift` creates exactly one exception and one new event.
- Retrying the UUID returns the same event and response.
- UUID reuse for another action fails.
- Two transactions or a supplied concurrency harness produce at most one current-day clock-in.
- Stale revision inserts nothing and returns latest state.
- Direct `anon` and `authenticated` writes to both new tables fail.
- Manager resolution links a correction batch.
- Dismissal without a reason fails.
- PIN and PIN hash never appear in request records.

- [ ] **Step 3: Run SQL tests and verify RED**

Against the approved disposable database:

```text
psql "$env:ATTENDANCE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/attendance_state_machine.sql
```

Expected: missing relation/function failure.

- [ ] **Step 4: Implement tables and constraints**

`attendance_exceptions` uses check constraints for the required normal and offline types and four statuses. Required types are `missing_clock_out`, `missing_clock_in`, `consecutive_clock_in`, `unmatched_clock_out`, `overlapping_attendance`, `unusually_long_shift`, `offline_sync_conflict`, `device_clock_drift`, and `offline_time_uncertain`. Add:

```sql
create unique index attendance_exceptions_open_fingerprint_idx
on public.attendance_exceptions (
  staff_id, operational_date, exception_type, anomaly_fingerprint
)
where status in ('open', 'under_review');
```

`attendance_action_requests.idempotency_key` is the UUID primary key. Add a 90-day `expires_at`, a completed response check, staff/device/action identity columns, and no authentication-secret columns.

- [ ] **Step 5: Implement pure SQL state derivation**

Use `get_effective_clock_events` and `attendance_operational_date`. `get_attendance_state` is stable for explicit `evaluated_at`, performs no insert/update/delete, and returns JSON containing state, current event, unresolved issues, allowed actions, warnings, revision, and evaluated time.

- [ ] **Step 6: Implement exception reconciliation**

Acquire `lock_attendance_staff_writes`, derive a bounded anomaly set, insert with the partial uniqueness rule, and return `{created, existing, skipped}` counts. Never update `clock_events` or `clock_event_corrections`.

- [ ] **Step 7: Implement the action transaction**

`perform_device_kiosk_attendance_action` validates device and PIN, locks the staff stream, checks idempotency identity, recomputes revision, validates allowed actions, reconciles stale exceptions only for `start_new_shift`, inserts one server-timestamped event, and stores the safe response.

Also redefine the legacy `record_kiosk_clock_event` path so it refuses a previous-day clock-out with `stale_shift_requires_review`; this protects rolling deployments.

- [ ] **Step 8: Implement manager resolution wrappers**

Require manager role and reason. Lock the staff stream, compare revision, call the existing correction-chain function, and update the exception status and correction batch in the same transaction.

- [ ] **Step 9: Add RLS, grants and function hardening**

For both new public tables:

```sql
alter table public.attendance_exceptions enable row level security;
alter table public.attendance_action_requests enable row level security;
revoke all on public.attendance_exceptions from public, anon, authenticated;
revoke all on public.attendance_action_requests from public, anon, authenticated;
```

Grant only manager reads where needed. Revoke `EXECUTE` from `PUBLIC` on every function. Grant the kiosk RPC only to `anon, authenticated`, manager RPCs only to `authenticated`, and no direct kiosk table writes.

- [ ] **Step 10: Run SQL tests and verify GREEN**

Run the same SQL test file against the disposable database. Inspect `pg_policies`, `information_schema.routine_privileges`, `pg_proc.proconfig`, constraints, triggers, and indexes.

- [ ] **Step 11: Commit**

```text
git add supabase/migrations/*_attendance_state_machine.sql supabase/tests/attendance_state_machine.sql
git commit -m "feat: add authoritative attendance transactions"
```

### Task 5: Adopt Explicit Kiosk State and Actions

**Files:**

- Modify: `src/lib/kiosk/types.ts`
- Modify: `src/lib/kiosk/security.ts`
- Modify: `src/lib/kiosk/actions.ts`
- Modify: `src/lib/kiosk/server.ts`
- Create: `src/lib/kiosk/presentation.ts`
- Test: `tests/kiosk-state-machine.test.ts`

**Interfaces:**

- Consumes the JSON result of `verify_device_kiosk_pin` and `perform_device_kiosk_attendance_action`
- Produces:

```ts
export type KioskAttendanceState = AttendanceStateResult;

export async function performKioskAttendanceAction(input: {
  staffId: string;
  pin: string;
  action: AttendanceAction;
  expectedRevision: string;
  idempotencyKey: string;
}): Promise<KioskActionResult>;

export function kioskActionPresentation(
  state: AttendanceStateResult,
  now: string,
): { heading: string; body: string; primaryLabel: string | null };
```

- [ ] **Step 1: Write failing mapping and presentation tests**

Assert:

- `missing_clock_out` produces “Start today’s shift”.
- `clocked_in` includes the original current-day clock-in time and only `clock_out`.
- Older exceptions appear as warnings without replacing a valid current state.
- `state_conflict` preserves the latest state and allowed actions.
- No presentation output contains pay, salary, hashes, internal SQL, or internal IDs.

- [ ] **Step 2: Run and verify RED**

```text
npm.cmd test -- tests/kiosk-state-machine.test.ts
```

- [ ] **Step 3: Expand kiosk result types and RPC mapping**

Map snake-case database results once in `src/lib/kiosk/actions.ts`. Generate the idempotency UUID in the browser before calling the action and retain it only for retries of that pending submission.

- [ ] **Step 4: Replace event-type submission with explicit action**

Remove the public action API that accepts only `eventType`. Call the new RPC with `action`, `expectedRevision`, and `idempotencyKey`.

- [ ] **Step 5: Verify GREEN**

```text
npm.cmd test -- tests/kiosk-state-machine.test.ts tests/kiosk.test.ts
```

- [ ] **Step 6: Commit**

```text
git add src/lib/kiosk/types.ts src/lib/kiosk/security.ts src/lib/kiosk/actions.ts src/lib/kiosk/server.ts src/lib/kiosk/presentation.ts tests/kiosk-state-machine.test.ts tests/kiosk.test.ts
git commit -m "feat: expose explicit kiosk attendance actions"
```

### Task 6: Redesign the Production Kiosk Confirmation Flow

**Files:**

- Modify: `src/components/kiosk/production-kiosk.tsx`
- Test: `tests/kiosk-state-machine.test.ts`

**Interfaces:**

- Consumes: `AttendanceStateResult`, `kioskActionPresentation`, `performKioskAttendanceAction`
- Produces: explicit confirmation and success screens

- [ ] **Step 1: Add failing reducer/view-model tests**

Extract or test a small reducer that proves:

- PIN is cleared after invalid, cancelled, successful, and timed-out attempts.
- Double taps while pending do not create a second submission key.
- A state conflict returns to the latest confirmation rather than success.
- Success records the server-provided timestamp and duration.

- [ ] **Step 2: Run and verify RED**

```text
npm.cmd test -- tests/kiosk-state-machine.test.ts
```

- [ ] **Step 3: Implement state-specific confirmation**

Show the staff name, local clock, current state, relevant clock-in time, warning acknowledgement, explicit primary action, and cancel. Use application copy without em dashes.

- [ ] **Step 4: Implement success and safe errors**

Display “Clocked in at …”, “Clocked out at …”, duration where applicable, and the older-shift review notice. Disable all mutation controls while pending.

- [ ] **Step 5: Run focused tests and lint**

```text
npm.cmd test -- tests/kiosk-state-machine.test.ts tests/kiosk.test.ts
npm.cmd run lint
```

- [ ] **Step 6: Commit**

```text
git add src/components/kiosk/production-kiosk.tsx tests/kiosk-state-machine.test.ts
git commit -m "feat: add kiosk attendance confirmation states"
```

### Task 7: Replace Direct Manager Corrections and Add Issue Resolution

**Files:**

- Create: `src/lib/attendance/exceptions-server.ts`
- Modify: `src/lib/attendance/review-server.ts`
- Modify: `src/lib/attendance/review-actions.ts`
- Modify: `src/lib/kiosk/actions.ts`
- Modify: `src/components/attendance/attendance-review.tsx`
- Modify: `src/components/attendance/production-attendance.tsx`
- Modify: `src/app/attendance/page.tsx`
- Test: `tests/attendance-exceptions.test.ts`
- Modify: `tests/attendance-review.test.ts`

**Interfaces:**

- Produces:

```ts
export async function loadAttendanceExceptions(filters: {
  status?: AttendanceExceptionStatus;
  type?: AttendanceExceptionType;
  from: string;
  to: string;
}): Promise<AttendanceExceptionRow[]>;

export async function resolveAttendanceExceptionAction(
  previous: AttendanceActionFormState,
  formData: FormData,
): Promise<AttendanceActionFormState>;

export async function dismissAttendanceExceptionAction(
  previous: AttendanceActionFormState,
  formData: FormData,
): Promise<AttendanceActionFormState>;
```

- [ ] **Step 1: Write failing server mapping and validation tests**

Test manager-only resolution, minimum reason length, expected revision propagation, correction plan mapping, dismissal audit fields, and state-conflict copy.

- [ ] **Step 2: Run and verify RED**

```text
npm.cmd test -- tests/attendance-exceptions.test.ts tests/attendance-review.test.ts
```

- [ ] **Step 3: Replace `addClockCorrectionAction`**

Remove direct `clock_events` insertion. Route manual addition/replacement/exclusion through existing correction-chain RPCs or the new exception resolution wrapper.

- [ ] **Step 4: Load original, effective and exception history**

Manager rows show original events separately from effective corrected events. Include rota suggestion without preselecting it as confirmed actual time.

- [ ] **Step 5: Add filtered issue UI**

Support open, under review, resolved, dismissed, type, date range, and staff filters. Provide resolve and dismiss forms with mandatory reasons and audit history.

- [ ] **Step 6: Verify GREEN**

```text
npm.cmd test -- tests/attendance-exceptions.test.ts tests/attendance-review.test.ts
```

- [ ] **Step 7: Commit**

```text
git add src/lib/attendance/exceptions-server.ts src/lib/attendance/review-server.ts src/lib/attendance/review-actions.ts src/lib/kiosk/actions.ts src/components/attendance/attendance-review.tsx src/components/attendance/production-attendance.tsx src/app/attendance/page.tsx tests/attendance-exceptions.test.ts tests/attendance-review.test.ts
git commit -m "feat: add auditable attendance issue resolution"
```

### Task 8: Make Payroll and Weekly Hours Exception-Safe

**Files:**

- Modify: `src/lib/payroll/types.ts`
- Modify: `src/lib/payroll/server.ts`
- Modify: `src/lib/payroll/calculations.ts`
- Modify: `src/components/payroll/production-payroll-screen.tsx`
- Modify: `src/app/payroll/export/route.ts`
- Modify: `src/lib/attendance/review-server.ts`
- Test: `tests/payroll-production.test.ts`
- Test: `tests/payroll-export.test.ts`
- Test: `tests/payroll-export-detail.test.ts`

**Interfaces:**

- Consumes: effective event rows and `pairAttendanceByOperationalDay`
- Produces:

```ts
export type PayrollAttendanceReadiness = {
  unresolvedReviewDays: number;
  pendingRequests: number;
  openExceptions: number;
  excludedMalformedMinutes: number;
};
```

- [ ] **Step 1: Write failing payroll pairing regressions**

Add fixtures proving:

- Cross-day adjacent events contribute zero.
- A valid pair on either side of a malformed sequence is retained.
- Unresolved exception counts appear in readiness.
- Export acknowledgement is required for clocked or combined output with open exceptions.
- Planned-only export remains available and clearly labelled.

- [ ] **Step 2: Run and verify RED**

```text
npm.cmd test -- tests/payroll-production.test.ts tests/payroll-export.test.ts tests/payroll-export-detail.test.ts
```

- [ ] **Step 3: Load effective rather than raw correction-blind attendance**

Use `get_effective_clock_events` for payroll attendance and preserve source metadata so original and manager-corrected values remain separately exportable.

- [ ] **Step 4: Replace global pairing**

Call `pairAttendanceByOperationalDay` per staff. Do not let adjacent events from separate days pair.

- [ ] **Step 5: Add readiness and export warning fields**

Prominently include open issue counts and excluded malformed sequences in the UI and workbook read-me sheet. Log export mode, date range, and unresolved counts without pay values.

- [ ] **Step 6: Verify GREEN**

```text
npm.cmd test -- tests/payroll-production.test.ts tests/payroll-export.test.ts tests/payroll-export-detail.test.ts
```

- [ ] **Step 7: Commit**

```text
git add src/lib/payroll/types.ts src/lib/payroll/server.ts src/lib/payroll/calculations.ts src/components/payroll/production-payroll-screen.tsx src/app/payroll/export/route.ts src/lib/attendance/review-server.ts tests/payroll-production.test.ts tests/payroll-export.test.ts tests/payroll-export-detail.test.ts
git commit -m "fix: exclude malformed attendance from payroll"
```

### Task 9: Align Staff History, Dashboard and Manager Hours

**Files:**

- Modify: `src/lib/staff-self-service/server.ts`
- Modify: `src/lib/dashboard/types.ts`
- Modify: `src/lib/dashboard/server.ts`
- Modify: `src/components/dashboard/production-dashboard.tsx`
- Modify: `src/lib/attendance/review-server.ts`
- Modify: the state-machine migration functions for dashboard/hours if required
- Test: `tests/staff-self-service.test.ts`
- Test: `tests/dashboard-production.test.ts`
- Test: `tests/attendance-review.test.ts`

**Interfaces:**

- Consumes: effective daily summaries and exception counts
- Produces: consistent current state, weekly hours, history anomalies and dashboard indicators

- [ ] **Step 1: Write failing consumer-alignment tests**

Test:

- Staff history uses effective corrections but does not permit edits.
- A stale prior-day clock-in does not appear in currently clocked-in.
- Dashboard unresolved issue count links to `/attendance?status=open`.
- Long current sessions remain clocked in and show warnings.
- Weekly hours exclude cross-day malformed pairs.

- [ ] **Step 2: Run and verify RED**

```text
npm.cmd test -- tests/staff-self-service.test.ts tests/dashboard-production.test.ts tests/attendance-review.test.ts
```

- [ ] **Step 3: Replace latest-event consumers**

Use authoritative state/daily summary functions in kiosk roster, manager attendance, dashboard, and hours preview. Remove direct latest-event binary derivation from those consumers.

- [ ] **Step 4: Update UI labels and links**

Distinguish valid current staff from stale or long sessions. Show issue count and filtered manager link.

- [ ] **Step 5: Verify GREEN**

Run the focused test command again.

- [ ] **Step 6: Commit**

```text
git add src/lib/staff-self-service/server.ts src/lib/dashboard/types.ts src/lib/dashboard/server.ts src/components/dashboard/production-dashboard.tsx src/lib/attendance/review-server.ts tests/staff-self-service.test.ts tests/dashboard-production.test.ts tests/attendance-review.test.ts supabase/migrations/*_attendance_state_machine.sql
git commit -m "feat: align attendance consumers with state machine"
```

### Task 10: Add Read-Only Diagnostics, Payroll Comparison and Controlled Backfill

**Files:**

- Create: `scripts/attendance-diagnostics.sql`
- Create: `scripts/attendance-payroll-comparison.sql`
- Add controlled backfill function to the generated state-machine migration
- Create: `tests/attendance-diagnostics.test.ts`

**Interfaces:**

- Produces diagnostic rows containing safe identifiers, dates, anomaly types, old minutes, new minutes and difference
- Produces backfill result `{created, existing, skipped}`

- [ ] **Step 1: Write failing diagnostic fixture tests**

Execute diagnostic SQL against a disposable fixture database and assert exact classifications for three consecutive clock-ins, five unmatched clock-outs, and nine long pairs. The fixture expected values must be literal.

- [ ] **Step 2: Run and verify RED**

Expected: missing scripts or missing backfill function.

- [ ] **Step 3: Implement read-only diagnostics**

Both scripts use `get_effective_clock_events`, make no writes, include operational dates, and order output deterministically. The payroll comparison reports every staff/date whose old and new minutes differ.

- [ ] **Step 4: Implement bounded idempotent backfill**

Require explicit `from`, `to`, and optional staff scope. Call exception reconciliation and return counts. Do not resolve, dismiss, update, or delete historical evidence.

- [ ] **Step 5: Run diagnostics against production read-only**

Save no staff names or pay values in the repository. Report aggregate counts and securely review the identified records with the manager before backfill.

- [ ] **Step 6: Verify GREEN**

Run diagnostic fixture tests and repeat the script against production in read-only mode.

- [ ] **Step 7: Commit**

```text
git add scripts/attendance-diagnostics.sql scripts/attendance-payroll-comparison.sql tests/attendance-diagnostics.test.ts supabase/migrations/*_attendance_state_machine.sql
git commit -m "feat: add attendance rollout diagnostics"
```

### Task 11: Add Structured Observability and Rollout Documentation

**Files:**

- Create or modify: `src/lib/attendance/telemetry.ts`
- Modify: kiosk, manager, and payroll server boundaries
- Create: `docs/attendance-state-machine-rollout.md`
- Test: `tests/attendance-observability.test.ts`

**Interfaces:**

- Produces:

```ts
export type AttendanceTelemetryEvent =
  | { name: "attendance.invalid_transition"; staffId: string; action: AttendanceAction; code: string }
  | { name: "attendance.state_conflict"; staffId: string; action: AttendanceAction }
  | { name: "attendance.idempotent_retry"; staffId: string; action: AttendanceAction }
  | { name: "attendance.exception_created"; staffId: string; exceptionType: AttendanceExceptionType }
  | { name: "attendance.manager_resolution_failed"; exceptionId: string; code: string }
  | { name: "attendance.payroll_export_unresolved"; from: string; to: string; unresolvedCount: number };
```

- [ ] **Step 1: Write failing redaction tests**

Assert emitted structured objects contain no `pin`, `pinHash`, `candidatePin`, `hourlyRate`, `annualSalary`, stack trace, or raw Supabase error.

- [ ] **Step 2: Run and verify RED**

```text
npm.cmd test -- tests/attendance-observability.test.ts
```

- [ ] **Step 3: Implement the existing-project logging boundary**

Use the established server logger if present. If none exists, use a small server-only JSON logger with an explicit allowlist of fields.

- [ ] **Step 4: Add logging at required outcomes**

Log invalid transitions, conflicts, retries, exception creation, failed manager resolution, and unresolved payroll export.

- [ ] **Step 5: Write the rollout runbook**

Include backup, exact migration reconciliation, fresh replay, diagnostics, review, migration, deployment, representative kiosk checks, controlled backfill, payroll comparison, monitoring, and additive rollback.

- [ ] **Step 6: Verify GREEN and commit**

```text
npm.cmd test -- tests/attendance-observability.test.ts
git add src/lib/attendance/telemetry.ts src/lib/kiosk/actions.ts src/lib/attendance/review-actions.ts src/app/payroll/export/route.ts docs/attendance-state-machine-rollout.md tests/attendance-observability.test.ts
git commit -m "chore: document and observe attendance rollout"
```

### Task 12: Establish the Offline Security and Hardware Gate

**Files:**

- Create: `docs/offline-kiosk-threat-model.md`
- Create: `src/lib/kiosk/offline/types.ts`
- Modify: `src/lib/kiosk/types.ts`
- Test: `tests/offline-kiosk-server.test.ts`

**Interfaces:**

- Produces:

```ts
export const OFFLINE_AUTHORISATION_HOURS = 24;
export const OFFLINE_CLOCK_DRIFT_SECONDS = 5 * 60;
export const OFFLINE_PIN_MAX_FAILURES = 3;
export const OFFLINE_RECEIPT_RETENTION_DAYS = 30;
export const OFFLINE_DEFINITIVE_QUEUE_RETENTION_DAYS = 7;

export type OfflineCapability =
  | { status: "disabled"; reason: "feature_flag" | "hardware_unverified" }
  | { status: "expired"; expiresAt: string }
  | { status: "ready"; authorisationId: string; rosterVersion: string; expiresAt: string };
```

- [ ] **Step 1: Write the failing capability-policy tests**

Use literal fixtures:

```ts
it("denies offline clocking when the registered device has not passed hardware validation", () => {
  expect(resolveOfflineCapability({
    offlineEnabled: true,
    hardwareVerifiedAt: null,
    expiresAt: "2026-07-31T09:00:00Z",
    now: "2026-07-30T09:00:00Z",
  })).toEqual({ status: "disabled", reason: "hardware_unverified" });
});

it("preserves an expired authorisation while denying new actions", () => {
  expect(resolveOfflineCapability({
    offlineEnabled: true,
    hardwareVerifiedAt: "2026-07-30T08:00:00Z",
    expiresAt: "2026-07-30T08:59:59Z",
    now: "2026-07-30T09:00:00Z",
  }).status).toBe("expired");
});
```

- [ ] **Step 2: Run and verify RED**

```text
npm.cmd test -- tests/offline-kiosk-server.test.ts
```

- [ ] **Step 3: Implement the central policy constants and capability function**

Do not read the browser clock as sole authority. The client uses the server-issued expiry conservatively; the server revalidates expiry at sync.

- [ ] **Step 4: Write the threat model**

Document offline guessing, developer-tools access, IndexedDB inspection, key invocation, device theft, service-worker compromise, XSS, replay, timestamp tampering, copied queue rows, revocation delay, storage eviction, and the limitations of browser-side encryption.

Record that repository inspection found no kiosk model, OS, browser, installed-PWA mode, or managed-device policy. Add a physical-device checklist for model, OS version, browser version, storage persistence, non-extractable key persistence, Background Sync support, restart recovery, storage pressure, clock change, and remote revocation.

- [ ] **Step 5: Verify GREEN and commit**

```text
npm.cmd test -- tests/offline-kiosk-server.test.ts
git add docs/offline-kiosk-threat-model.md src/lib/kiosk/offline/types.ts src/lib/kiosk/types.ts tests/offline-kiosk-server.test.ts
git commit -m "docs: define offline kiosk security gate"
```

### Task 13: Build the Versioned PWA Shell and Durable IndexedDB Queue

**Files:**

- Create: `src/app/manifest.ts`
- Create: `public/sw.js`
- Create: `src/components/kiosk/service-worker-registration.tsx`
- Create: `src/lib/kiosk/offline/database.ts`
- Create: `src/lib/kiosk/offline/projection.ts`
- Create: `src/lib/kiosk/offline/queue.ts`
- Create: `src/lib/kiosk/offline/connectivity.ts`
- Modify: `src/app/clock/page.tsx`
- Modify: `src/components/kiosk/production-kiosk.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/offline-kiosk-database.test.ts`
- Test: `tests/offline-kiosk-service-worker.test.ts`

**Interfaces:**

- Produces:

```ts
export const OFFLINE_DB_NAME = "jan-staff-clock";
export const OFFLINE_DB_VERSION = 1;

export type PendingAttendanceAction = {
  schemaVersion: 1;
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

export async function replaceRosterAtomically(snapshot: OfflineRosterSnapshot): Promise<void>;
export async function enqueueAttendanceAction(input: UnsignedPendingAction): Promise<PendingAttendanceAction>;
export async function persistSyncReceipt(input: SyncReceiptTransaction): Promise<void>;
export async function buildProvisionalState(staffId: string): Promise<AttendanceStateResult>;
```

- [ ] **Step 1: Install the pinned IndexedDB test dependency**

```text
npm.cmd install --save-dev --save-exact fake-indexeddb@6.2.5
```

Commit lockfile changes with this task.

- [ ] **Step 2: Write failing database tests**

Using real IndexedDB semantics from `fake-indexeddb`, prove:

- Atomic roster replacement leaves the old roster active after a failed new write.
- Pending actions survive database close and reopen.
- Trusted state is not mutated by provisional projection.
- Multiple staff actions retain global sequence and per-staff order.
- Receipt, trusted snapshot, and definitive queue status commit atomically.
- Queue schema upgrade retains version 1 actions.
- Routine cleanup keeps pending, conflicted, and indeterminate actions.
- Serialised stores do not contain fields matching `/pin|pin_hash|hourly|salary/i`.

- [ ] **Step 3: Run and verify RED**

```text
npm.cmd test -- tests/offline-kiosk-database.test.ts
```

- [ ] **Step 4: Implement the IndexedDB repository**

Use stores `metadata`, `rosters`, `trustedStates`, `pinVerifiers`, `pinLockouts`, `pendingActions`, `syncReceipts`, and `localAudit`. All state transitions use explicit transactions. Do not use `localStorage`.

- [ ] **Step 5: Write failing service-worker cache tests**

Parse or execute the service worker in a controlled harness and assert observable cache requests:

- `/clock` and required static assets are eligible.
- `/attendance`, `/payroll`, `/compliance`, Supabase URLs, and `/api/kiosk/offline/*` responses are not put in the shell cache.
- Activation removes obsolete cache versions.
- Fetch failure for `/clock` returns the compatible cached shell.
- Background Sync absence does not prevent registration.

- [ ] **Step 6: Implement the manifest and service worker**

Use a narrow `/clock` scope, versioned cache name, network-first document strategy, cache-first immutable static strategy, and no response-body caching for API or manager routes.

- [ ] **Step 7: Register the worker only on the production kiosk**

Registration failure must leave online kiosk operation intact. The demo route remains unchanged.

- [ ] **Step 8: Verify GREEN and commit**

```text
npm.cmd test -- tests/offline-kiosk-database.test.ts tests/offline-kiosk-service-worker.test.ts
git add package.json package-lock.json src/app/manifest.ts public/sw.js src/components/kiosk/service-worker-registration.tsx src/lib/kiosk/offline/database.ts src/lib/kiosk/offline/projection.ts src/lib/kiosk/offline/queue.ts src/lib/kiosk/offline/connectivity.ts src/app/clock/page.tsx src/components/kiosk/production-kiosk.tsx tests/offline-kiosk-database.test.ts tests/offline-kiosk-service-worker.test.ts
git commit -m "feat: add durable offline kiosk shell"
```

### Task 14: Add Device-Specific Offline PIN Enrolment

**Files:**

- Create: `src/lib/kiosk/offline/crypto.ts`
- Create: `src/app/api/kiosk/offline/provision/route.ts`
- Modify: `src/lib/kiosk/actions.ts`
- Modify: `src/components/kiosk/production-kiosk.tsx`
- Test: `tests/offline-kiosk-pin.test.ts`
- Test: `tests/offline-kiosk-server.test.ts`

**Interfaces:**

- Produces:

```ts
export type OfflinePinVerifierEnvelope = {
  schemaVersion: 1;
  staffId: string;
  authorisationId: string;
  salt: string;
  iterations: number;
  verifier: string;
  expiresAt: string;
};

export async function createDeviceKeys(): Promise<{
  signingPrivateKey: CryptoKey;
  signingPublicJwk: JsonWebKey;
  verifierKey: CryptoKey;
}>;

export async function enrolOfflinePin(input: {
  pin: string;
  staffId: string;
  authorisationId: string;
  expiresAt: string;
  verifierKey: CryptoKey;
}): Promise<OfflinePinVerifierEnvelope>;

export async function verifyOfflinePin(input: {
  pin: string;
  envelope: OfflinePinVerifierEnvelope;
  verifierKey: CryptoKey;
  lockout: OfflinePinLockout;
}): Promise<OfflinePinVerificationResult>;
```

- [ ] **Step 1: Write failing cryptographic behaviour tests**

Prove:

- Verifier accepts the enrolled six-digit PIN and rejects another.
- Four- and five-digit PINs are ineligible for offline enrolment.
- Plaintext PIN is absent from the envelope and IndexedDB serialisation.
- The production bcrypt hash is never an input or output.
- Verifier is scoped to staff and authorisation.
- Expired verifier fails before derivation.
- Three failures persist; the fourth attempt returns locked without performing another comparison.
- Editing the lockout record invalidates its authenticator.
- Signing the same canonical payload is verifiable; changing device, staff, action, UUID, sequence, or time invalidates it.

- [ ] **Step 2: Run and verify RED**

```text
npm.cmd test -- tests/offline-kiosk-pin.test.ts
```

- [ ] **Step 3: Implement Web Crypto enrolment**

Use non-extractable ECDSA P-256 signing private key, non-extractable HMAC-SHA-256 verifier key, random 128-bit salts, PBKDF2-SHA-256 with a benchmarked central iteration count, constant-time byte comparison, and immediate PIN variable clearing at the caller boundary.

- [ ] **Step 4: Implement online enrolment flow**

Only a successful online server PIN verification may enrol or refresh that staff member’s device-specific verifier. The server provisioning route validates the registered-device HttpOnly cookie, current roster, per-device feature flag, hardware verification, public key, and 24-hour expiry.

- [ ] **Step 5: Add kiosk readiness labels**

Clearly distinguish “Online PIN ready” from “Offline ready”. Staff without six-digit enrolment remain online-capable.

- [ ] **Step 6: Verify GREEN and commit**

```text
npm.cmd test -- tests/offline-kiosk-pin.test.ts tests/offline-kiosk-server.test.ts tests/kiosk-state-machine.test.ts
git add src/lib/kiosk/offline/crypto.ts src/app/api/kiosk/offline/provision/route.ts src/lib/kiosk/actions.ts src/components/kiosk/production-kiosk.tsx tests/offline-kiosk-pin.test.ts tests/offline-kiosk-server.test.ts
git commit -m "feat: enrol device-specific offline PIN verifiers"
```

### Task 15: Synchronise Signed Offline Actions Through the State Machine

**Files:**

- Generate: the exact CLI-generated `supabase/migrations/*_offline_kiosk_attendance.sql` file from Step 1
- Create: `src/app/api/kiosk/offline/sync/route.ts`
- Create: `src/app/api/kiosk/offline/health/route.ts`
- Create: `src/lib/kiosk/offline/sync.ts`
- Modify: `src/lib/auth/supabase-admin.ts`
- Modify: `src/lib/kiosk/server.ts`
- Modify: `src/lib/kiosk/actions.ts`
- Modify: `src/components/kiosk/production-kiosk.tsx`
- Modify: `src/components/kiosk/device-management.tsx`
- Modify: `src/lib/payroll/server.ts`
- Modify: `src/lib/payroll/types.ts`
- Modify: `src/components/payroll/production-payroll-screen.tsx`
- Modify: `supabase/tests/attendance_state_machine.sql`
- Test: `tests/offline-kiosk-sync.test.ts`
- Test: `tests/offline-kiosk-server.test.ts`
- Test: `tests/payroll-production.test.ts`

**Interfaces:**

- Database objects:

```sql
public.kiosk_offline_authorisations
public.kiosk_sync_health
public.perform_offline_kiosk_attendance_action(...)
public.report_kiosk_sync_health(...)
public.discard_offline_kiosk_actions(...)
```

- Produces:

```ts
export type OfflineSyncOutcome =
  | "synced"
  | "already_processed"
  | "unauthorised"
  | "conflicted"
  | "retryable_failure"
  | "permanently_invalid";

export async function syncPendingActions(trigger: "launch" | "online" | "visibility" | "periodic" | "manual" | "background"): Promise<OfflineSyncSummary>;
```

- [ ] **Step 1: Generate the migration through the CLI**

```text
npx.cmd supabase migration new --help
npx.cmd supabase migration new offline_kiosk_attendance
```

- [ ] **Step 2: Write failing SQL and route tests**

Prove:

- New authorisation is tied to one active registered kiosk and public key.
- Default expiry is no more than 24 hours.
- Offline action uses the same attendance advisory lock and idempotency UUID.
- Accepted event stores `occurred_at_device`, `received_at_server`, authorisation, device sequence, and drift result.
- Occurrence outside the authorisation window conflicts.
- Future, reordered, wrong-timezone, suspicious pre-contact, and over-threshold drift evidence conflicts.
- Revoked device, expired authorisation, removed staff, changed roster, bad signature assertion, and changed device identity are unauthorised or conflicted as specified.
- Conflict action remains stored and creates one source-labelled exception.
- Direct `anon` and `authenticated` execution of the offline database RPC fails.
- Server route without valid registered-device cookie fails.
- Idempotent replay returns the original definitive outcome.
- UUID reuse with changed payload fails.

- [ ] **Step 3: Run and verify RED**

Run Vitest route tests and the SQL integration script against the disposable database.

- [ ] **Step 4: Implement additive offline schema**

Add authorisation and device-health tables with RLS and narrow grants. Extend attendance requests and accepted events with offline audit fields without rewriting historical rows. Add indexes for device sequence, pending/conflict status, expiry, and health.

- [ ] **Step 5: Implement server time and conflict validation**

Use both device occurrence and server receipt. A five-minute drift threshold is central. Network delay alone is not drift. When elapsed-time confidence is unavailable after restart, classify uncertain evidence rather than silently accepting it.

- [ ] **Step 6: Implement the same-origin sync route**

Validate the HttpOnly device cookie and ECDSA signature with Web Crypto in the Next.js server runtime. Call a server-only database function which repeats device, authorisation, staff, sequence, revision, and action validation. Do not expose the service-role key or grant the offline RPC to browser roles.

- [ ] **Step 7: Write failing queue-worker tests**

Prove:

- Manual, reconnect, launch, visibility, periodic, and optional background triggers share one single-flight worker.
- Ordering is device sequence, occurrence, then queue time.
- One staff stream is serial.
- Network loss during item two leaves item two and later items pending.
- Server acceptance with lost response is recovered by UUID.
- A durable receipt is stored before pending payload cleanup.
- Background Sync firing twice does not duplicate.
- Different staff may progress after one staff conflicts without reordering either stream.

- [ ] **Step 8: Implement the synchronisation worker**

Use an IndexedDB lease to prevent overlapping tabs or service-worker and foreground workers. Keep the original signed payload and UUID for every retry.

- [ ] **Step 9: Add kiosk sync status UI**

Always show online, offline, synchronising, sync problem, or expired. Show pending count, oldest age, last success, manual sync, and manager-review outcomes. Use pending-specific confirmations.

- [ ] **Step 10: Add manager device health and safe discard**

Show last contact, roster refresh, expiry, last reported pending count, oldest age, failure, drift, feature flag, hardware verification, and revocation. Prevent ordinary reset from clearing unresolved queue data. Manager discard requires reason and diagnostic export.

- [ ] **Step 11: Protect payroll**

Pending local actions remain absent from server attendance. Conflicted server requests contribute no hours. Payroll readiness includes offline conflicts, last reported pending count, and unknown recently offline device state.

- [ ] **Step 12: Verify GREEN and commit**

```text
npm.cmd test -- tests/offline-kiosk-sync.test.ts tests/offline-kiosk-server.test.ts tests/payroll-production.test.ts
git add supabase/migrations/*_offline_kiosk_attendance.sql supabase/tests/attendance_state_machine.sql src/app/api/kiosk/offline/sync/route.ts src/app/api/kiosk/offline/health/route.ts src/lib/kiosk/offline/sync.ts src/lib/auth/supabase-admin.ts src/lib/kiosk/server.ts src/lib/kiosk/actions.ts src/components/kiosk/production-kiosk.tsx src/components/kiosk/device-management.tsx src/lib/payroll/server.ts src/lib/payroll/types.ts src/components/payroll/production-payroll-screen.tsx tests/offline-kiosk-sync.test.ts tests/offline-kiosk-server.test.ts tests/payroll-production.test.ts
git commit -m "feat: synchronise offline kiosk attendance"
```

### Task 16: Full Database, Security, Offline and Application Verification

**Files:**

- Modify only files required to fix verification failures caused by this feature
- Update `docs/attendance-state-machine-rollout.md` with verified results and limitations

**Interfaces:**

- Consumes: complete implementation
- Produces: evidence-backed release status

- [ ] **Step 1: Replay every repository migration on a disposable PostgreSQL 17 database**

Verify the fresh database correction tables, operation tables, functions, triggers, grants, revocations, and RLS policies match the corresponding production objects before applying the new feature migration.

- [ ] **Step 2: Run SQL integration and RLS tests**

```text
psql "$env:ATTENDANCE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/attendance_state_machine.sql
```

Run anonymous, registered kiosk, authenticated staff, and authenticated manager cases separately.

Verify the offline database RPC is denied to public browser roles and reachable only through the validated server sync boundary.

- [ ] **Step 3: Run the complete application verification**

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

- [ ] **Step 4: Run automated offline recovery scenarios**

Use browser automation and controlled network interception to verify:

- First authorised online setup, complete sync, and offline reopen
- Offline clock-in and clock-out
- Reload, browser restart simulation, and service-worker restart
- Network loss during synchronisation
- Server acceptance with lost client response
- Background Sync present, absent, and repeated
- App update with queued version 1 evidence
- Revoked and expired authorisation
- Wrong device time and changed device identifier
- Manager reset protection with pending actions

Inspect Cache Storage and IndexedDB to confirm no plaintext PIN, production PIN hash, pay value, full staff record, manager response, or broad API cache.

- [ ] **Step 5: Test the actual Jan Preschool kiosk**

Record the tablet model, OS, browser, installed-PWA mode, available storage, and device-management controls. Repeat offline action, browser restart, tablet restart, service-worker update, storage-pressure, network-loss, queue recovery, non-extractable-key persistence, and clock-change scenarios.

If the device is unavailable or any scenario fails, keep `offline_enabled` false and document full offline clocking as not complete.

- [ ] **Step 6: Run production diagnostics read-only**

Execute both diagnostic scripts without DDL or DML. Compare old and new pairing totals and document every changed staff/date securely.

- [ ] **Step 7: Inspect the final diff and migration safety**

Check:

```text
git diff --check
git status --short
git diff --stat
```

Confirm no unrelated user-owned changes were overwritten and no pay or PIN data entered kiosk responses, logs, fixtures, documentation, caches, IndexedDB, or offline receipts.

- [ ] **Step 8: Update release status**

If every command, database test, browser recovery scenario, and physical-device test passes, document the verified staged rollout sequence. If disposable database access or the physical kiosk remains unavailable, state exactly which database or offline claims remain unverified and keep offline enablement false.

- [ ] **Step 9: Commit verification documentation**

```text
git add docs/attendance-state-machine-rollout.md
git commit -m "docs: record attendance verification results"
```

## Plan Self-Review

- Every design requirement maps to at least one task.
- Historical migration recovery is the first implementation gate.
- No feature migration is allowed before exact migration hashes pass.
- Operational-day derivation is central and DST-tested.
- State reads and exception writes are separate.
- Kiosk mutations are explicit, locked, revision-checked and idempotent.
- Manager changes use correction chains and retain audit history.
- Payroll and weekly hours cannot pair across operational days.
- Diagnostics precede historical backfill.
- RLS and function grants receive direct actor tests.
- Multi-tenant isolation is explicitly not claimed.
- Full completion is conditional on disposable PostgreSQL verification.
- Offline browser storage is provisional and never becomes attendance authority.
- Offline PIN verification uses device-specific material, six-digit enrolment, short expiry, and local lockout without exposing production hashes.
- Queue durability, idempotent sync, conflicts, timestamps, safe reset, service-worker scope, and payroll exclusion each have direct tests.
- Background Sync is optional; foreground and manual sync are the correctness baseline.
- Offline enablement remains conditional on physical Jan Preschool device verification.
