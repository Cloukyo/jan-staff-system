# Attendance Reset to Planned Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers exclude individual clock events or atomically reset a malformed attendance day to its published start and finish while preserving the complete audit trail.

**Architecture:** Add two manager-only, append-only Supabase RPCs in a new migration. Bound Next.js server actions call those RPCs with the rendered attendance revision and operation UUID, and the existing attendance correction controls expose confirmed removal and reset forms. Payroll continues to consume resolved effective events while retaining original and correction detail in the Daily Clocking worksheet.

**Tech Stack:** Next.js App Router, React 19 server actions, TypeScript, Supabase PostgreSQL/PLpgSQL, Vitest, PGlite, ExcelJS.

## Global Constraints

- Use UK date and time formats and the Europe/London timezone.
- Original `clock_events` rows are immutable.
- Every manager change is an append-only `clock_event_corrections` row.
- Only managers can perform removal or reset operations.
- Use **Remove from hours**, not **Delete**, in application copy.
- Reset removes all effective intermediate events; lunch clock-out and clock-in are added manually afterward.
- Corrected exports use effective events and continue to show raw originals and correction audit separately.
- Require a correction reason of at least five characters.
- Reject stale attendance revisions without partial writes.
- Do not expose pay information on the kiosk.
- Do not add dependencies.

---

### Task 1: Append-only removal RPC

**Files:**
- Create: `supabase/migrations/202607290001_attendance_remove_and_reset.sql`
- Modify: `tests/helpers/attendance-corrections-db.ts`
- Modify: `tests/attendance-corrections-db.test.ts`
- Modify: `tests/attendance-corrections.test.ts`

**Interfaces:**
- Consumes: `public.get_effective_clock_events`, `public.get_attendance_event_revision`, `public.lock_attendance_staff_writes`, and the existing correction chain constraints.
- Produces: `public.remove_clock_event_from_hours(target_staff_id text, target_date date, target_event_id uuid, reason text, expected_revision text, operation_id uuid) returns uuid`.

- [ ] **Step 1: Write failing database tests**

Add PGlite tests that call the proposed RPC and assert:

```sql
select public.remove_clock_event_from_hours(
  $1, $2::date, $3::uuid, $4, $5, $6::uuid
)::text as batch_id
```

The tests must prove that an original event receives an active `exclude` correction, an active manager-added event receives an `exclude` correction with `supersedes_correction_id`, neither source row is deleted, a stale revision writes nothing, a non-manager is rejected, a reason shorter than five characters is rejected, and retrying the same `operation_id` returns the first batch without adding rows.

- [ ] **Step 2: Run the removal tests and verify RED**

Run:

```powershell
npx vitest run tests/attendance-corrections-db.test.ts tests/attendance-corrections.test.ts
```

Expected: FAIL because `public.remove_clock_event_from_hours` and the new migration do not exist.

- [ ] **Step 3: Implement the removal RPC**

Create the new migration. The function must:

```sql
create or replace function public.remove_clock_event_from_hours(
  target_staff_id text,
  target_date date,
  target_event_id uuid,
  reason text,
  expected_revision text,
  operation_id uuid
) returns uuid
```

Validate manager access, required inputs and reason; acquire the staff write lock; return an existing matching `batch_id = operation_id` before the revision check for retry safety; compare `expected_revision`; resolve only the currently effective target event; append one `exclude` correction using `original_event_id` for an original or `supersedes_correction_id` for a correction; use `operation_id` as both the batch id and new correction id; and revoke public/anon access while granting execute to authenticated users.

- [ ] **Step 4: Load the new migration in PGlite and verify GREEN**

Update `createAttendanceTestDatabase()` to execute the new migration after `202607280001_clock_event_corrections.sql`.

Run:

```powershell
npx vitest run tests/attendance-corrections-db.test.ts tests/attendance-corrections.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the removal RPC**

```powershell
git add supabase/migrations/202607290001_attendance_remove_and_reset.sql tests/helpers/attendance-corrections-db.ts tests/attendance-corrections-db.test.ts tests/attendance-corrections.test.ts
git commit -m "Add append-only attendance event removal"
```

### Task 2: Atomic reset RPC

**Files:**
- Modify: `supabase/migrations/202607290001_attendance_remove_and_reset.sql`
- Modify: `tests/helpers/attendance-corrections-db.ts`
- Modify: `tests/attendance-corrections-db.test.ts`
- Modify: `tests/attendance-corrections.test.ts`

**Interfaces:**
- Consumes: the same attendance revision, effective-event and staff-lock functions as Task 1, plus published `rota_shifts` and `rota_weeks`.
- Produces: `public.reset_attendance_to_planned_hours(target_staff_id text, target_date date, reason text, expected_revision text, operation_id uuid) returns uuid`.

- [ ] **Step 1: Write failing reset tests**

Add tests that call:

```sql
select public.reset_attendance_to_planned_hours(
  $1, $2::date, $3, $4, $5::uuid
)::text as batch_id
```

Seed a malformed sequence containing originals and active corrections. Assert that one call leaves exactly a planned `clock_in` and planned `clock_out` effective, preserves all originals, stores exclusions and additions under one batch, and calculates the full boundary duration. Add tests for an already-correct day, no published shift, stale revision with zero writes, non-manager rejection, and idempotent retry.

- [ ] **Step 2: Run reset tests and verify RED**

Run:

```powershell
npx vitest run tests/attendance-corrections-db.test.ts tests/attendance-corrections.test.ts
```

Expected: FAIL because `public.reset_attendance_to_planned_hours` is absent.

- [ ] **Step 3: Implement the atomic reset**

The RPC must:

```sql
create or replace function public.reset_attendance_to_planned_hours(
  target_staff_id text,
  target_date date,
  reason text,
  expected_revision text,
  operation_id uuid
) returns uuid
```

After authorization, idempotency, locking and revision validation, lock the published shifts and calculate the earliest start and latest finish in Europe/London. Snapshot effective events. Insert one `exclude` correction per effective event followed by `add` corrections at the planned start and finish, all with `batch_id = operation_id`, one trimmed reason, and deterministic primary/consequential roles. Perform all inserts in the function transaction so any failure rolls back the reset.

- [ ] **Step 4: Verify reset tests GREEN**

Run:

```powershell
npx vitest run tests/attendance-corrections-db.test.ts tests/attendance-corrections.test.ts
```

Expected: PASS with effective events exactly matching planned boundaries.

- [ ] **Step 5: Commit the reset RPC**

```powershell
git add supabase/migrations/202607290001_attendance_remove_and_reset.sql tests/helpers/attendance-corrections-db.ts tests/attendance-corrections-db.test.ts tests/attendance-corrections.test.ts
git commit -m "Add atomic reset to planned attendance"
```

### Task 3: Bound server actions

**Files:**
- Modify: `src/lib/attendance/correction-actions.ts`
- Modify: `tests/attendance-correction-action.test.ts`

**Interfaces:**
- Consumes: `BoundAttendanceCorrectionContext` with bound `staffId`, `attendanceDate`, `correctionId`, `returnTo`, and `eventRevision`.
- Produces: `removeBoundClockEventAction(context, state, formData)` and `resetBoundAttendanceToPlannedHoursAction(context, state, formData)`.

- [ ] **Step 1: Write failing action tests**

Assert that removal sends only the form’s `targetEventId` and `reason`, while staff/date/revision/operation id come from bound context:

```ts
expect(rpc).toHaveBeenCalledWith("remove_clock_event_from_hours", {
  target_staff_id: "staff-1",
  target_date: "2026-07-28",
  target_event_id: "10000000-0000-4000-8000-000000000000",
  reason: "Duplicate clock event",
  expected_revision: context().eventRevision,
  operation_id: context().correctionId,
});
```

Assert reset calls `reset_attendance_to_planned_hours`; both actions reject invalid UUIDs and short reasons before opening a database client, map SQLSTATE `40001` to `attendance_changed`, revalidate attendance/clock/payroll routes, and return specific success and failure copy.

- [ ] **Step 2: Run action tests and verify RED**

Run:

```powershell
npx vitest run tests/attendance-correction-action.test.ts
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement the actions**

Add small input validators and private RPC wrappers following `applyPlannedHours`. Keep authorization before form validation. Export the two bound action functions, trim reasons, validate event and operation UUIDs, and reuse `attendanceChangedResult()` and `revalidateAttendancePaths()`.

- [ ] **Step 4: Run action tests and verify GREEN**

Run:

```powershell
npx vitest run tests/attendance-correction-action.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the actions**

```powershell
git add src/lib/attendance/correction-actions.ts tests/attendance-correction-action.test.ts
git commit -m "Add attendance removal and reset actions"
```

### Task 4: Manager correction controls

**Files:**
- Modify: `src/components/attendance/attendance-correction-controls.tsx`
- Modify: `src/components/attendance/staff-hours-timeline.tsx`
- Modify: `src/lib/help/manager-help.ts`
- Modify: `tests/attendance-manager-views.test.ts`

**Interfaces:**
- Consumes: `removeBoundClockEventAction`, `resetBoundAttendanceToPlannedHoursAction`, `StaffHoursDay.effectiveEvents`, and published `plannedPeriods`.
- Produces: visible per-event **Remove from hours** forms and an always-actionable **Reset to planned hours** form when a published shift exists.

- [ ] **Step 1: Write failing rendered-source tests**

Test that the controls render:

- **Reset to planned hours** before individual event controls;
- each effective event timestamp and type in the reset preview;
- planned start and finish additions;
- the lunch-removal warning;
- a required confirmation checkbox and reason;
- **Remove from hours** in every effective event correction panel;
- copy stating that original records remain in history.

Also assert the old ambiguous-sequence warning no longer disables reset.

- [ ] **Step 2: Run manager view tests and verify RED**

Run:

```powershell
npx vitest run tests/attendance-manager-views.test.ts
```

Expected: FAIL because the reset and removal controls are not rendered.

- [ ] **Step 3: Implement confirmation forms and wiring**

Bind both new actions in `StaffHoursDayDetail`. Replace the disabled planned-hours form with a reset form that previews every effective removal and the two planned additions. Require an HTML confirmation checkbox:

```tsx
<input name="confirmed" type="checkbox" value="yes" required />
```

Place a removal section beneath each existing fix form with its own reason, confirmation checkbox, hidden target event id, and danger-styled **Remove from hours** submit button. On success, preserve the current day URL and refresh. Update manager help wording to explain reset followed by manual lunch entry.

- [ ] **Step 4: Run manager view and action tests GREEN**

Run:

```powershell
npx vitest run tests/attendance-manager-views.test.ts tests/attendance-correction-action.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the interface**

```powershell
git add src/components/attendance/attendance-correction-controls.tsx src/components/attendance/staff-hours-timeline.tsx src/lib/help/manager-help.ts tests/attendance-manager-views.test.ts
git commit -m "Add attendance removal and reset controls"
```

### Task 5: Export regression and full verification

**Files:**
- Modify: `tests/payroll-export-detail.test.ts`

**Interfaces:**
- Consumes: `createPayrollExportDetail()` and resolved attendance containing originals, exclusions, and manager-added boundaries/lunch events.
- Produces: regression proof that raw and corrected exports remain separate after reset.

- [ ] **Step 1: Write the export regression**

Create an attendance fixture for 08:00 to 18:00 with preserved malformed originals, active exclusion corrections, reset boundaries, and manager-added lunch events at 12:00 and 13:00. Assert:

```ts
expect(row.rawWorkedMinutes).toBe(480);
expect(row.workedMinutes).toBe(540);
expect(row.originalClockIns).toContain("2026-07-28T08:00:00+01:00");
expect(row.correctionRecords).toEqual(
  expect.arrayContaining([expect.objectContaining({ kind: "exclude" })]),
);
```

- [ ] **Step 2: Run the export test and verify its assertion**

Run:

```powershell
npx vitest run tests/payroll-export-detail.test.ts
```

Expected: PASS because the existing export already separates original and effective records. Temporarily set the corrected expectation to `600`, verify it fails with `540`, then restore `540` and rerun to prove the fixture exercises the lunch deduction.

- [ ] **Step 3: Run all static and automated verification**

Run:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
git diff --check origin/main...HEAD
```

Expected: every command exits successfully.

- [ ] **Step 4: Verify the rendered workflow**

Start the app and verify desktop and mobile attendance views. Confirm reset is enabled for an ambiguous day, confirmation text does not overlap, removal buttons have accessible labels and touch targets, reset leaves planned boundaries, and adding lunch changes 10.00 hours to 9.00 hours.

- [ ] **Step 5: Request code review and address findings**

Run the `superpowers:requesting-code-review` process against `origin/main...HEAD`. Fix critical and important findings under focused tests, then rerun the full verification commands.

- [ ] **Step 6: Commit final regression coverage**

```powershell
git add tests/payroll-export-detail.test.ts
git commit -m "Verify corrected attendance export after reset"
```

- [ ] **Step 7: Push, open a pull request, merge and deploy**

Push `codex/attendance-reset-planned-hours`, open a ready pull request, merge after checks pass, deploy the saved main version to production, and verify `https://jan-staff-system.vercel.app` loads the updated attendance workflow.
