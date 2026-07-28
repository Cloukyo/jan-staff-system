# Staff Hours Timeline Final Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all eight final review findings while preserving immutable original clock events, append-only correction chains and existing row-level security.

**Architecture:** Keep browser previews advisory and move authoritative manual correction planning into a manager-only PostgreSQL RPC protected by the existing per-staff transaction lock. Bind all manager confirmation actions to an event revision derived from the displayed original and correction IDs. Keep payroll, manager history and staff self-service explicit about raw, effective and audit representations.

**Tech Stack:** Next.js App Router, React 19 server actions, TypeScript, Supabase PostgreSQL, Vitest, PGlite.

## Global Constraints

- Use UK date, time and currency formats and the Europe/London timezone.
- Original `clock_events` rows remain immutable.
- New correction rows are append-only and correction forks are rejected.
- Staff cannot write attendance and cannot read correction reasons, manager identity or pay data.
- The public kiosk must not expose pay or manager-only information.
- Do not apply the migration, push, deploy or modify live data.
- Run focused tests, executable PostgreSQL tests, the full suite with four workers, lint, type checking and the production build.

---

### Task 1: Pure Date, Pairing, Preview And Payroll Regressions

**Files:**
- Modify: `tests/date-format.test.ts`
- Modify: `tests/attendance-corrections.test.ts`
- Modify: `tests/payroll-production.test.ts`
- Modify: `src/lib/dates/format.ts`
- Modify: `src/components/attendance/attendance-correction-controls.tsx`
- Modify: `src/lib/payroll/calculations.ts`
- Modify: `src/app/payroll/page.tsx`
- Modify: `src/app/payroll/export/route.ts`

**Interfaces:**
- `londonLocalDateTimeToUtc(value)` rejects nonexistent local times and selects the later GMT instant during an overlap.
- `calculateClockTotals(events)` never pairs events from different `recordedDate` values.
- `createPayrollPreparationRow(staff, originalEvents, effectiveEvents, periodStart, periodEnd, reviews)` exposes raw and reviewed minutes separately.

- [x] Add a spring gap rejection test and an autumn overlap test expecting `2026-10-25T01:30:00.000Z`.
- [x] Run `npm.cmd test -- tests/date-format.test.ts` and confirm the new assertions fail for the current conversion.
- [x] Add a planned preview test where equivalent `+01:00` and `Z` instants classify at the same boundary.
- [x] Run `npm.cmd test -- tests/attendance-corrections.test.ts` and confirm the preview test fails because ISO strings are compared lexically.
- [x] Add payroll tests proving Monday clock-in plus Tuesday clock-out remains unpaid and proving 08:00 to 17:00 raw versus 09:00 to 17:00 reviewed yields 540 and 480 minutes.
- [x] Run `npm.cmd test -- tests/payroll-production.test.ts` and confirm both regressions fail.
- [x] Implement round-trip London wall-time validation, epoch preview comparisons, per-date payroll pairing and the explicit raw/effective payroll signature.
- [x] Run the three focused files again and confirm all pass.

### Task 2: Transactional Correction And Security Regressions

**Files:**
- Modify: `tests/attendance-corrections-db.test.ts`
- Modify: `tests/helpers/attendance-corrections-db.ts`
- Modify: `supabase/migrations/202607280001_clock_event_corrections.sql`

**Interfaces:**
- `get_attendance_event_revision(target_staff_id, target_date)` derives a deterministic revision from append-only original and correction IDs and is not directly executable by application roles.
- `save_manual_clock_event_correction(target_staff_id, target_date, target_event_id, requested_event_type, requested_event_timestamp, reason, expected_revision)` plans and inserts one correction batch under the attendance write lock.
- `get_own_attendance_records(range_start, range_end)` derives staff ownership from the authenticated account and returns no reason, manager or pay columns.
- `use_planned_hours(target_staff_id, target_date, reason, expected_revision)` rejects stale event previews.

- [x] Add executable tests that correct an active correction, re-fix an original by superseding its active leaf and reject sibling correction forks.
- [x] Add an executable stale-revision test that inserts a kiosk event after preview and confirms no correction row is saved.
- [x] Add executable tests proving the manual RPC creates authoritative same-day consequences and rejects a staff caller.
- [x] Add executable SQL total tests proving events on adjacent dates are never paired.
- [x] Add executable ownership tests proving the staff RPC returns only the caller's records and exposes no private correction fields.
- [x] Run `npm.cmd test -- tests/attendance-corrections-db.test.ts` and confirm the new RPC and behaviour assertions fail.
- [x] Add the revision helper, transactional manual RPC, correction fork validation, date partitions and limited staff RPC without granting broader table access.
- [x] Re-run the PostgreSQL test file and confirm it passes.

### Task 3: Server Integration And Manager Workflows

**Files:**
- Modify: `tests/attendance-correction-action.test.ts`
- Modify: `tests/attendance-manager-views.test.ts`
- Modify: `tests/paged-attendance-loaders.test.ts`
- Modify: `src/lib/attendance/correction-actions.ts`
- Modify: `src/lib/attendance/staff-hours.ts`
- Modify: `src/lib/attendance/manager-view.ts`
- Modify: `src/lib/staff-self-service/server.ts`
- Modify: `src/lib/kiosk/server.ts`
- Modify: `src/app/attendance/page.tsx`
- Modify: `src/components/attendance/attendance-correction-controls.tsx`
- Modify: `src/components/attendance/staff-hours-timeline.tsx`
- Modify: `src/components/attendance/production-attendance.tsx`
- Modify: `src/lib/kiosk/actions.ts`

**Interfaces:**
- `StaffHoursDay.eventRevision` is bound into server actions and is never accepted from form data.
- Fix controls target effective event IDs, including correction IDs.
- `loadMissingEventPage(staffId, date)` creates a standalone blank correction day without adding it to staff week results.
- Clocking history uses a union of original and correction audit records.
- My attendance calls only the authenticated `get_own_attendance_records` RPC.

- [x] Replace action tests with assertions for one call to `save_manual_clock_event_correction`, a bound revision, correction targets and a clear stale-preview result.
- [x] Add manager view tests for an unscheduled blank day add workflow, correction-first fix controls and original plus correction history records.
- [x] Replace the service-role pagination test with an authenticated limited-RPC test.
- [x] Run the three focused files and confirm the new expectations fail.
- [x] Add deterministic day revisions, bind them in manual and planned actions and map stale SQL errors to reload-and-review copy.
- [x] Change correction controls to list effective events and reuse the missing-event form on the global add route.
- [x] Add the staff/date global selection loader and page while leaving week relevance rules unchanged.
- [x] Load and render original and correction audit records in Clocking history.
- [x] Replace My attendance service-role reads with the ownership-checked RPC.
- [x] Re-run the focused files and confirm they pass.

### Task 4: Final Verification, Report And Commit

**Files:**
- Create: `.superpowers/sdd/2026-07-28-staff-hours-timeline/final-fix-report.md`
- Modify only if verification identifies a fix-wave regression.

- [x] Run focused attendance, action, kiosk, staff self-service, payroll and date tests.
- [x] Run `npm.cmd test -- tests/attendance-corrections-db.test.ts`.
- [x] Run `npm.cmd test -- --maxWorkers=4`.
- [x] Run `npm.cmd run lint`.
- [x] Run `npm.cmd run typecheck`.
- [x] Run `npm.cmd run build`.
- [x] Run `git diff --check` and inspect the complete diff for privacy, RLS and immutability regressions.
- [x] Write exact commands, counts and results to the final fix report.
- [x] Stage only fix-wave files and commit them on `codex/staff-hours-timeline`.
