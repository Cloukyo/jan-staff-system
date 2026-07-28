# Staff Hours Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an audit-safe per-person weekly attendance timeline, a Yesterday shortcut, manual event correction, and a one-action Use planned hours correction.

**Architecture:** Store manager corrections in a new append-only table and resolve them into an effective event stream without changing `clock_events`. A shared pure analyser produces sessions, totals and warnings for every server loader. Server components load authoritative models, while client components only handle expansion, form state and confirmation.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase PostgreSQL and RLS, Zod-style server validation patterns, Tailwind CSS, Lucide React, Vitest.

## Global Constraints

- Use UK date, time and currency formats and the Europe/London timezone.
- Preserve every original clock event.
- Store manager corrections separately from original clock records.
- Never expose pay information on kiosk or attendance correction screens.
- Staff cannot edit attendance history.
- Keep touch targets at least 44px and do not rely on colour for warnings.
- Do not add runtime dependencies.
- Keep existing demo functionality working.
- Do not use em dashes in user-facing copy.
- Run lint, type checking, all tests and a production build before deployment.

## File Structure

- Create `supabase/migrations/202607280001_clock_event_corrections.sql`: correction table, RLS, effective-event function and transactional planned-hours RPC.
- Create `src/lib/attendance/effective-events.ts`: pure correction-chain resolution.
- Create `src/lib/attendance/sequence.ts`: pure day pairing and warning analysis.
- Create `src/lib/attendance/staff-hours.ts`: server loaders and presentation models for staff list, staff week and Yesterday.
- Create `src/lib/attendance/correction-actions.ts`: manager actions for replace, add and planned-hours corrections.
- Create `src/components/attendance/staff-hours-list.tsx`: clickable staff summary.
- Create `src/components/attendance/staff-hours-timeline.tsx`: weekly day rows, expanded timeline and mobile event table.
- Create `src/components/attendance/attendance-correction-controls.tsx`: manual and planned-hours action forms.
- Modify `src/app/attendance/page.tsx`: parse staff/date/week parameters and load only the active view.
- Modify `src/components/attendance/attendance-page-nav.tsx`: add Yesterday and rename Staff hours.
- Modify `src/components/attendance/production-attendance.tsx`: remove the old hours-only table and reuse focused components.
- Modify `src/lib/attendance/manager-view.ts`: add the Yesterday and staff detail view values.
- Modify `src/lib/attendance/review-server.ts`: consume effective events for review calculations.
- Modify `src/lib/kiosk/server.ts`: load effective events for manager status while retaining audit events.
- Modify `src/lib/payroll/server.ts`: supply effective events for calculated pay-preparation hours and raw events for audit exports.
- Modify `src/lib/staff-self-service/server.ts`: show effective totals while preserving original and correction labels.
- Modify `src/lib/help/manager-help.ts`: document the new common tasks and shortcuts.
- Test in `tests/attendance-corrections.test.ts`, `tests/attendance-review.test.ts`, `tests/attendance-manager-views.test.ts`, `tests/payroll-review.test.ts`, and `tests/navigation.test.ts`.

---

### Task 1: Effective Event Domain

**Files:**
- Create: `src/lib/attendance/effective-events.ts`
- Create: `src/lib/attendance/sequence.ts`
- Create: `tests/attendance-corrections.test.ts`

**Interfaces:**
- Produces: `resolveEffectiveEvents(events, corrections): ResolvedAttendanceEvents`
- Produces: `analyseAttendanceDay(input): AttendanceDayAnalysis`
- Produces: `planAlternatingEventTypes(input): PlannedEventTypeCorrection[]`
- Consumes: no database or React APIs.

- [ ] **Step 1: Write failing correction-resolution tests**

Cover unchanged originals, replacement, add, exclude, superseded correction,
legacy manager events, same-day alternating type plans, date boundaries and
deterministic timestamp/ID ordering:

```ts
expect(resolveEffectiveEvents([clockOut("original", "08:01")], [
  replace("fix", "original", "clock_in", "08:01"),
]).effective.map(({ eventType }) => eventType)).toEqual(["clock_in"]);
expect(result.audit.originals[0].status).toBe("replaced");
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- tests/attendance-corrections.test.ts`
Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement append-only correction resolution**

Define explicit types:

```ts
export type AttendanceCorrectionKind = "add" | "replace" | "exclude";
export type EffectiveClockEvent = {
  id: string;
  staffId: string;
  eventType: "clock_in" | "clock_out";
  eventTimestamp: string;
  recordedDate: string;
  source: "kiosk" | "legacy_manager" | "manager_correction";
  originalEventId: string | null;
  correctionId: string | null;
};
```

Follow `supersedesCorrectionId` chains, retain only active leaf corrections,
exclude targeted originals, add replacement/add records and return a separate
audit model.

- [ ] **Step 4: Implement the daily sequence analyser**

Return `sessions`, `completedMinutes`, `hasOpenShift`, `warnings` and
`suggestedMissingType`. Do not infer times. Detect:

```ts
type AttendanceWarning =
  | "missing_clock_in"
  | "missing_clock_out"
  | "clock_out_before_clock_in"
  | "duplicate_clock_in"
  | "duplicate_clock_out"
  | "events_wrong_order"
  | "no_planned_shift";
```

- [ ] **Step 5: Implement the consequential type planner**

Starting from the manager-selected event, walk only later effective events on
the same `recordedDate`. Alternate the expected type and return replacements
only for mismatches. Preserve every timestamp and never include another date.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/attendance-corrections.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/attendance/effective-events.ts src/lib/attendance/sequence.ts tests/attendance-corrections.test.ts
git commit -m "Add effective attendance event analysis"
```

### Task 2: Append-Only Correction Database

**Files:**
- Create: `supabase/migrations/202607280001_clock_event_corrections.sql`
- Modify: `tests/attendance-corrections.test.ts`

**Interfaces:**
- Consumes: correction kinds and semantics from Task 1.
- Produces: table `clock_event_corrections`
- Produces: function `get_effective_clock_events(date, date, text)`
- Produces: function `save_clock_event_correction_chain(jsonb)`
- Produces: function `use_planned_hours(text, date, text)`

- [ ] **Step 1: Add failing migration contract tests**

Assert the migration contains:

```ts
expect(sql).toContain("create table public.clock_event_corrections");
expect(sql).toContain("supersedes_correction_id");
expect(sql).toContain("Managers can add clock event corrections");
expect(sql).toContain("public.use_planned_hours");
expect(sql).not.toMatch(/update public\.clock_events|delete from public\.clock_events/i);
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- tests/attendance-corrections.test.ts`
Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Create the correction table and RLS**

Use immutable insert/select policies for managers. Include foreign keys to
`staff_profiles`, `clock_events`, `clock_event_corrections` and
`staff_accounts`. Add constraints that require replace and exclude corrections
to target either an original event or a superseded correction, never neither.
Add corrections have no original event unless they supersede an earlier
correction. Require a five-character reason.

- [ ] **Step 4: Create the effective-event SQL function**

Return original IDs, correction IDs, staff ID, event type, timestamp, recorded
date and source. Resolve superseded correction rows and suppress originals
targeted by active replace/exclude rows.

- [ ] **Step 5: Create transactional Use planned hours RPC**

The security-definer function must:

1. require a manager account;
2. lock and reload published, non-cancelled rota shifts for the staff date;
3. reject an empty rota;
4. use the earliest published start and latest published finish as boundaries;
5. replace or add the first clock-in boundary;
6. replace or add the final clock-out boundary;
7. preserve every intermediate timestamp, including lunchtime events;
8. replace intermediate event types only when they conflict with the
   alternating sequence;
9. use Europe/London conversion for local shift times;
10. return the correction batch ID.

- [ ] **Step 6: Create transactional correction-chain RPC**

Accept one validated correction plan as JSONB, require a manager, re-check that
all targeted events belong to one staff member and one recorded date, then
insert the primary and consequential replacements as one batch.

- [ ] **Step 7: Update manager and staff weekly-hours SQL functions**

Replace direct calculated reads from `clock_events` with
`get_effective_clock_events`. Leave audit reads on the base tables.

- [ ] **Step 8: Run focused and existing database-contract tests**

Run: `npm test -- tests/attendance-corrections.test.ts tests/attendance-review.test.ts tests/kiosk.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/202607280001_clock_event_corrections.sql tests/attendance-corrections.test.ts
git commit -m "Add append-only attendance corrections"
```

### Task 3: Correction Repository and Server Actions

**Files:**
- Create: `src/lib/attendance/correction-actions.ts`
- Modify: `src/lib/kiosk/actions.ts`
- Modify: `tests/attendance-corrections.test.ts`

**Interfaces:**
- Consumes: `clock_event_corrections` and `use_planned_hours` from Task 2.
- Produces: `saveClockEventCorrectionAction`
- Produces: `usePlannedHoursAction`
- Preserves: `addClockCorrectionAction` as a compatibility wrapper.

- [ ] **Step 1: Add failing validation and immutability tests**

Assert manager-only access, five-character reasons, ownership checks, no
`clock_events` update/delete and revalidation of attendance, kiosk and payroll.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- tests/attendance-corrections.test.ts`
Expected: FAIL because the actions are missing.

- [ ] **Step 3: Implement manual add and replace actions**

Accept:

```ts
type CorrectionActionInput = {
  staffId: string;
  originalEventId?: string;
  eventType: "clock_in" | "clock_out";
  localDateTime: string;
  reason: string;
  returnTo: string;
};
```

Load the original event server-side when provided. Verify its staff ID before
inserting a replace correction. Convert `datetime-local` input explicitly
using Europe/London utilities rather than the server machine timezone. Build
the same-day alternating correction plan and submit the complete batch to the
transactional RPC.

- [ ] **Step 4: Implement planned-hours action**

Send only `staffId`, `attendanceDate` and `reason` to the RPC. Never accept rota
times from browser form data.

- [ ] **Step 5: Keep the existing missing-event form compatible**

Change `addClockCorrectionAction` to delegate to the new add correction path so
all future manager changes use the separate table.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/attendance-corrections.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/attendance/correction-actions.ts src/lib/kiosk/actions.ts tests/attendance-corrections.test.ts
git commit -m "Add attendance correction actions"
```

### Task 4: Staff Hours and Yesterday Loaders

**Files:**
- Create: `src/lib/attendance/staff-hours.ts`
- Modify: `src/lib/attendance/review-server.ts`
- Modify: `src/lib/kiosk/server.ts`
- Modify: `src/lib/payroll/server.ts`
- Modify: `src/lib/staff-self-service/server.ts`
- Modify: `tests/attendance-review.test.ts`
- Modify: `tests/payroll-review.test.ts`

**Interfaces:**
- Consumes: Task 1 resolver/analyser and Task 2 SQL function.
- Produces: `loadStaffHoursList(from?, to?)`
- Produces: `loadStaffHoursWeek(staffId, from?, to?)`
- Produces: `loadAttendanceDay(date)`
- Produces: `previousLondonDate(reference?)`

- [ ] **Step 1: Add failing loader and date tests**

Test the London date transition, current configured work week, issue-first
sorting, multiple rota periods, untouched lunchtime timestamps and preservation
of both audit and effective records.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- tests/attendance-corrections.test.ts tests/attendance-review.test.ts tests/payroll-review.test.ts`
Expected: FAIL on missing loaders and old raw totals.

- [ ] **Step 3: Implement focused attendance loaders**

Load active profiles, relevant published rota shifts, original events,
corrections and reviews. Build presentation models on the server. Return no pay
fields.

- [ ] **Step 4: Update attendance review and kiosk manager status**

Use effective events for first/last times, warnings and current status. Keep
raw audit rows available for Clocking history.

- [ ] **Step 5: Update pay preparation and staff self-service**

Calculate totals from effective events. Retain original and correction records
as separate audit arrays and labels. Do not grant staff write access.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/attendance-corrections.test.ts tests/attendance-review.test.ts tests/payroll-review.test.ts tests/staff-self-service.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/attendance/staff-hours.ts src/lib/attendance/review-server.ts src/lib/kiosk/server.ts src/lib/payroll/server.ts src/lib/staff-self-service/server.ts tests
git commit -m "Load effective staff attendance hours"
```

### Task 5: Navigation and Staff Hours Screens

**Files:**
- Create: `src/components/attendance/staff-hours-list.tsx`
- Create: `src/components/attendance/staff-hours-timeline.tsx`
- Modify: `src/app/attendance/page.tsx`
- Modify: `src/components/attendance/attendance-page-nav.tsx`
- Modify: `src/components/attendance/production-attendance.tsx`
- Modify: `src/lib/attendance/manager-view.ts`
- Modify: `tests/attendance-manager-views.test.ts`
- Modify: `tests/navigation.test.ts`

**Interfaces:**
- Consumes: staff list/week/day models from Task 4.
- Produces: routes using `view=yesterday`, `view=hours`, `staffId`, `hoursFrom`,
  `hoursTo` and `day`.

- [ ] **Step 1: Add failing navigation and rendering contract tests**

Assert Yesterday follows Today, Hours summary copy becomes Staff hours, staff
rows link to a selected staff ID, and page loaders are selected by active view.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- tests/attendance-manager-views.test.ts tests/navigation.test.ts`
Expected: FAIL on absent navigation and components.

- [ ] **Step 3: Add Yesterday navigation**

Resolve the previous date in Europe/London. Render a daily issue-first list with
an Open action that expands the same day detail component.

- [ ] **Step 4: Build Staff hours list**

Render date controls, previous/current/next week actions, effective completed
hours, open-shift text and issue counts. Use a clear Open hours action.

- [ ] **Step 5: Build individual weekly view**

Render planned periods, effective sequence, total and warning text per day.
Expanded detail shows planned, original and effective lanes plus a semantic
event table on mobile. Use Lucide icons and 44px controls.

- [ ] **Step 6: Update the page server boundary**

Import pure parsing functions only from server-safe modules. Do not call an
export from a `"use client"` module in `page.tsx`.

- [ ] **Step 7: Run focused tests**

Run: `npm test -- tests/attendance-manager-views.test.ts tests/navigation.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/attendance src/components/attendance src/lib/attendance/manager-view.ts tests/attendance-manager-views.test.ts tests/navigation.test.ts
git commit -m "Add staff hours timeline views"
```

### Task 6: Inline Manual and Planned-Hours Controls

**Files:**
- Create: `src/components/attendance/attendance-correction-controls.tsx`
- Modify: `src/components/attendance/staff-hours-timeline.tsx`
- Modify: `src/components/attendance/production-attendance.tsx`
- Modify: `src/lib/help/manager-help.ts`
- Modify: `tests/attendance-corrections.test.ts`
- Modify: `tests/help.test.ts`

**Interfaces:**
- Consumes: actions from Task 3 and day model from Task 4.
- Produces: accessible Fix event, Add missing event and Use planned hours forms.

- [ ] **Step 1: Add failing UI contract tests**

Assert forms carry staff/date/original IDs, show the original value, use a
dropdown for event type, use `datetime-local`, require a reason and do not post
planned shift times. Assert the confirmation previews every consequential event
type change and preserves its recorded time.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- tests/attendance-corrections.test.ts tests/help.test.ts`
Expected: FAIL because controls and help tasks are missing.

- [ ] **Step 3: Implement Fix event and Add missing event**

Use `useActionState`, keep the expanded day in the return URL, display action
feedback, and include original versus corrected values before submission.

- [ ] **Step 4: Implement Use planned hours confirmation**

Show the earliest planned start and latest planned finish in UK time. State
that lunchtime timestamps are unchanged and preview any required type changes.
The confirmation form posts only staff ID, date, reason and return URL.

- [ ] **Step 5: Update manager help**

Add tasks for fixing one event, using planned hours and reviewing one person's
week, with direct attendance URLs.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/attendance-corrections.test.ts tests/help.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/attendance src/lib/help/manager-help.ts tests/attendance-corrections.test.ts tests/help.test.ts
git commit -m "Add intuitive attendance correction controls"
```

### Task 7: Full Verification and Production Release

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- Consumes: completed Tasks 1 to 6.
- Produces: a verified production deployment.

- [ ] **Step 1: Run focused attendance tests**

Run: `npm test -- tests/attendance-corrections.test.ts tests/attendance-review.test.ts tests/attendance-manager-views.test.ts tests/payroll-review.test.ts tests/navigation.test.ts tests/help.test.ts`
Expected: PASS.

- [ ] **Step 2: Run the full quality suite**

Run:

```bash
npm run lint
npm run typecheck
npm test -- --maxWorkers=4
npm run build
```

Expected: all commands pass.

- [ ] **Step 3: Apply the migration to the linked Supabase project**

Verify the target project ID and current migration state before applying
`202607280001_clock_event_corrections.sql`. Confirm the table, RLS policies and
RPCs exist. Do not modify or delete clock event rows.

- [ ] **Step 4: Deploy a preview and verify authenticated workflows**

At desktop and mobile widths:

1. open Clock-ins & hours;
2. open Yesterday;
3. open Margaret Q in Staff hours;
4. verify reversed/missing warnings;
5. save a manual correction in a non-production test fixture or preview-safe
   account;
6. verify Use planned hours confirmation content;
7. verify original and corrected events remain visible;
8. inspect browser console and preview runtime errors.

- [ ] **Step 5: Commit verification fixes**

```bash
git add <only-files-changed-for-verification>
git commit -m "Verify staff hours correction workflow"
```

Skip the commit when verification required no code changes.

- [ ] **Step 6: Push, open a ready pull request and merge after checks**

Push `codex/staff-hours-timeline`, create a ready PR with migration and
immutability notes, wait for checks, then merge.

- [ ] **Step 7: Verify production**

Confirm the production deployment is READY. In the authenticated production
session, verify Yesterday, Staff hours, an expanded day and correction forms.
Check `/attendance` runtime errors after those real requests. Do not perform a
live correction unless the manager explicitly identifies a record to change.
