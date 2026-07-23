# Payroll Workbook Rota and Daily Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a monthly planned-rota matrix and an auditable daily clocking worksheet to the manager payroll Excel export.

**Architecture:** Introduce a small pure export-detail builder that converts filtered staff, rota shifts, clock events and attendance reviews into workbook-ready rows. Add a period-based production rota loader, then pass its results through the existing manager-only export route into the ExcelJS workbook builder.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, ExcelJS, date-fns, Vitest

## Global Constraints

- Use UK date, time and currency formats.
- Use the Europe/London timezone.
- Preserve original clock events and show manager correction events separately.
- Do not calculate tax, PAYE, National Insurance, pensions or payslips.
- Do not silently omit planned rota data when its production query fails.
- Keep the existing manager-only permission and unreviewed-export confirmation.
- Do not add a new runtime dependency.
- Do not use em dashes in user-facing application copy.
- Preserve the existing demo functionality.

---

### Task 1: Build Pure Planned and Daily Export Detail Rows

**Files:**
- Create: `src/lib/exports/payroll-detail.ts`
- Modify: `src/lib/payroll/types.ts`
- Create: `tests/payroll-export-detail.test.ts`

**Interfaces:**
- Consumes: `ProductionStaffRow[]`, `ProductionClockEvent[]`, `PayrollAttendanceReview[]`, `PayrollRotaShift[]`, `periodStart`, `periodEnd`
- Produces: `createPayrollExportDetail(...) => PayrollExportDetail`
- Produces: `PayrollExportDetail` with `dates`, `plannedRows` and `dailyRows`

- [ ] **Step 1: Add the failing export-detail tests**

Create fixtures covering a future shift, a cancelled shift, two same-day shifts, an overnight shift, original events, manager correction events and an attendance review. Assert:

```ts
const detail = createPayrollExportDetail({
  staff: [staff],
  shifts,
  events,
  reviews,
  periodStart: "2026-07-01",
  periodEnd: "2026-07-03",
});

expect(detail.dates).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
expect(detail.plannedRows[0].plannedMinutesByDate["2026-07-02"]).toBe(900);
expect(detail.dailyRows[0].originalClockIns).toEqual(["2026-07-01T08:00:00+01:00"]);
expect(detail.dailyRows[0].managerClockIns).toEqual(["2026-07-01T08:15:00+01:00"]);
expect(detail.dailyRows[0].rawWorkedMinutes).toBe(480);
expect(detail.dailyRows[0].workedMinutes).toBe(465);
```

Also assert cancelled and archived shifts do not contribute, future rota-only dates produce daily rows and raw/corrected event arrays never overlap.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd test -- tests/payroll-export-detail.test.ts
```

Expected: FAIL because `payroll-detail.ts` and its exported interfaces do not exist.

- [ ] **Step 3: Add payroll export detail types**

Add to `src/lib/payroll/types.ts`:

```ts
export type PayrollRotaShift = {
  id: string;
  staffId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  status: "scheduled" | "completed";
};

export type PayrollPlannedRow = {
  staffId: string;
  fullName: string;
  employmentRole: string;
  plannedMinutesByDate: Record<string, number>;
};

export type PayrollDailyRow = {
  staffId: string;
  fullName: string;
  employmentRole: string;
  date: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  plannedBreakMinutes: number;
  plannedMinutes: number;
  originalClockIns: string[];
  originalClockOuts: string[];
  managerClockIns: string[];
  managerClockOuts: string[];
  rawWorkedMinutes: number;
  workedMinutes: number;
  reviewStatus: PayrollAttendanceReview["status"] | "not_reviewed";
  reviewReason: string | null;
  warnings: string[];
};

export type PayrollExportDetail = {
  dates: string[];
  plannedRows: PayrollPlannedRow[];
  dailyRows: PayrollDailyRow[];
};
```

- [ ] **Step 4: Implement the pure detail builder**

In `src/lib/exports/payroll-detail.ts`, use `eachDayOfInterval`, `format`, `parseISO` and the existing `calculateClockTotals`:

```ts
export function plannedShiftMinutes(shift: PayrollRotaShift): number {
  const start = parseISO(`${shift.shiftDate}T${shift.startTime}:00`);
  let end = parseISO(`${shift.shiftDate}T${shift.endTime}:00`);
  if (end <= start) end = addDays(end, 1);
  return Math.max(0, differenceInMinutes(end, start) - shift.breakMinutes);
}

export function createPayrollExportDetail(input: PayrollExportDetailInput): PayrollExportDetail {
  const dates = eachDayOfInterval({
    start: parseISO(input.periodStart),
    end: parseISO(input.periodEnd),
  }).map((date) => format(date, "yyyy-MM-dd"));
  const key = (staffId: string, date: string) => `${staffId}:${date}`;
  const shiftsByDay = new Map<string, PayrollRotaShift[]>();
  const eventsByDay = new Map<string, ProductionClockEvent[]>();
  const reviewsByDay = new Map(
    input.reviews.map((review) => [key(review.staffId, review.reviewDate), review]),
  );

  for (const shift of input.shifts) {
    const group = shiftsByDay.get(key(shift.staffId, shift.shiftDate)) ?? [];
    group.push(shift);
    shiftsByDay.set(key(shift.staffId, shift.shiftDate), group);
  }
  for (const event of input.events) {
    const group = eventsByDay.get(key(event.staffId, event.recordedDate)) ?? [];
    group.push(event);
    eventsByDay.set(key(event.staffId, event.recordedDate), group);
  }

  const plannedRows = input.staff.map((person) => ({
    staffId: person.id,
    fullName: person.fullName,
    employmentRole: person.employmentRole,
    plannedMinutesByDate: Object.fromEntries(
      dates.map((date) => [
        date,
        (shiftsByDay.get(key(person.id, date)) ?? [])
          .reduce((sum, shift) => sum + plannedShiftMinutes(shift), 0),
      ]),
    ),
  }));

  const dailyRows = input.staff.flatMap((person) =>
    dates.flatMap((date) => {
      const dayKey = key(person.id, date);
      const shifts = (shiftsByDay.get(dayKey) ?? [])
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      const events = (eventsByDay.get(dayKey) ?? [])
        .sort((a, b) => a.eventTimestamp.localeCompare(b.eventTimestamp));
      const review = reviewsByDay.get(dayKey);
      if (shifts.length === 0 && events.length === 0 && !review) return [];

      const originals = events.filter((event) => !event.managerCorrection);
      const corrections = events.filter((event) => event.managerCorrection);
      const raw = calculateClockTotals(originals);
      const adjusted = calculateClockTotals(events);
      const warnings = [...adjusted.warnings];
      if (events.length > 0 && !review) warnings.push("Attendance review incomplete");

      return [{
        staffId: person.id,
        fullName: person.fullName,
        employmentRole: person.employmentRole,
        date,
        plannedStart: shifts.length ? shifts.map((shift) => shift.startTime).join(", ") : null,
        plannedEnd: shifts.length ? shifts.map((shift) => shift.endTime).join(", ") : null,
        plannedBreakMinutes: shifts.reduce((sum, shift) => sum + shift.breakMinutes, 0),
        plannedMinutes: shifts.reduce((sum, shift) => sum + plannedShiftMinutes(shift), 0),
        originalClockIns: originals.filter((event) => event.eventType === "clock_in")
          .map((event) => event.eventTimestamp),
        originalClockOuts: originals.filter((event) => event.eventType === "clock_out")
          .map((event) => event.eventTimestamp),
        managerClockIns: corrections.filter((event) => event.eventType === "clock_in")
          .map((event) => event.eventTimestamp),
        managerClockOuts: corrections.filter((event) => event.eventType === "clock_out")
          .map((event) => event.eventTimestamp),
        rawWorkedMinutes: raw.recordedMinutes,
        workedMinutes: adjusted.recordedMinutes,
        reviewStatus: review?.status ?? "not_reviewed",
        reviewReason: review?.reason ?? null,
        warnings: Array.from(new Set(warnings)),
      }];
    }),
  );

  return { dates, plannedRows, dailyRows };
}
```

Reuse `calculateClockTotals` for raw and all-event totals so the detail worksheet reconciles with `Payroll Preparation`.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/payroll-export-detail.test.ts
```

Expected: all export-detail tests pass.

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/lib/exports/payroll-detail.ts src/lib/payroll/types.ts tests/payroll-export-detail.test.ts
git commit -m "Build payroll export rota and daily details"
```

---

### Task 2: Add Planned Rota and Daily Clocking Worksheets

**Files:**
- Modify: `src/lib/exports/payroll-excel.ts`
- Modify: `tests/payroll-review.test.ts`

**Interfaces:**
- Consumes: `PayrollExportDetail` from Task 1
- Produces: `createPayrollPreparationWorkbook(rows, start, end, reviewState, detail)`

- [ ] **Step 1: Add failing workbook tests**

Extend the workbook tests to pass a three-day `PayrollExportDetail` and assert:

```ts
expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
  "Payroll Preparation",
  "Planned Rota",
  "Daily Clocking",
  "Read Me",
]);

const planned = workbook.getWorksheet("Planned Rota")!;
expect(planned.getCell("C1").value).toContain("Wed 01/07");
expect(planned.getCell("F2").formula).toBe("SUM(C2:E2)");

const daily = workbook.getWorksheet("Daily Clocking")!;
expect(daily.getCell("H2").value).toBe("08:00");
expect(daily.getCell("J2").value).toBe("08:15");
expect(daily.getCell("L2").value).toBe(8);
expect(daily.getCell("M2").value).toBe(7.75);
```

Assert frozen panes, filters, UK date formatting, two-decimal hour formatting, future rota-only rows and the explanatory notes.

- [ ] **Step 2: Run the workbook test and verify RED**

Run:

```powershell
npm.cmd test -- tests/payroll-review.test.ts
```

Expected: FAIL because the new worksheets are absent and the workbook does not accept detail data.

- [ ] **Step 3: Add the Planned Rota worksheet**

Extend the workbook function with a default empty detail:

```ts
export async function createPayrollPreparationWorkbook(
  rows: PayrollPreparationRow[],
  periodStart: string,
  periodEnd: string,
  reviewState: PayrollWorkbookReviewState = { unresolved: 0, pendingRequests: 0 },
  detail: PayrollExportDetail = { dates: [], plannedRows: [], dailyRows: [] },
): Promise<Buffer>
```

Create `Planned Rota` after `Payroll Preparation`. Use staff name and role columns, dynamic date columns, a formula total, frozen panes and an autofilter. Convert minutes to numeric decimal hours. Label dates with `EEE dd/MM` and add a top note explaining that future planned shifts are included and breaks are deducted.

- [ ] **Step 4: Add the Daily Clocking worksheet**

Create `Daily Clocking` after `Planned Rota`. Add the columns specified in the design, format event timestamps with the existing `formatTimeUk`, format the date as `dd/mm/yyyy`, keep multiple events joined with `, `, use two-decimal numeric hours and wrap notes/warnings.

Original event columns must read only `originalClockIns` and `originalClockOuts`. Manager correction columns must read only `managerClockIns` and `managerClockOuts`.

- [ ] **Step 5: Run the workbook tests and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/payroll-review.test.ts
```

Expected: all payroll workbook tests pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add src/lib/exports/payroll-excel.ts tests/payroll-review.test.ts
git commit -m "Add rota and daily sheets to payroll workbook"
```

---

### Task 3: Load Period Rota Data and Connect the Export Route

**Files:**
- Modify: `src/lib/payroll/server.ts`
- Modify: `src/app/payroll/export/route.ts`
- Modify: `tests/payroll-export.test.ts`

**Interfaces:**
- Produces: `loadPayrollRotaShifts(periodStart, periodEnd): Promise<PayrollRotaShift[]>`
- Consumes: `createPayrollExportDetail(...)`

- [ ] **Step 1: Add failing route and loader contract tests**

Add assertions that:

```ts
expect(server).toContain("export async function loadPayrollRotaShifts");
expect(server).toContain('.gte("shift_date", periodStart)');
expect(server).toContain('.lte("shift_date", periodEnd)');
expect(route).toContain("loadPayrollRotaShifts(periodStart, periodEnd)");
expect(route).toContain("createPayrollExportDetail");
expect(route).toContain("readiness,");
expect(route).toContain("detail,");
```

Keep the existing confirmation-policy assertions unchanged.

- [ ] **Step 2: Run the route test and verify RED**

Run:

```powershell
npm.cmd test -- tests/payroll-export.test.ts
```

Expected: FAIL because the period rota loader and detail wiring are absent.

- [ ] **Step 3: Implement the period rota loader**

In `src/lib/payroll/server.ts`, load non-archived rota week IDs, then query shifts within the selected period:

```ts
export async function loadPayrollRotaShifts(
  periodStart: string,
  periodEnd: string,
): Promise<PayrollRotaShift[]> {
  const supabase = await createSupabaseServerClient();
  const weeks = await supabase
    .from("rota_weeks")
    .select("id")
    .neq("status", "archived")
    .is("archived_at", null);
  if (weeks.error) throw new Error("Production rota data could not be loaded.");
  const weekIds = (weeks.data ?? []).map((week) => week.id);
  if (weekIds.length === 0) return [];

  const shifts = await supabase
    .from("rota_shifts")
    .select("id,staff_id,shift_date,start_time,end_time,break_minutes,status")
    .in("rota_week_id", weekIds)
    .gte("shift_date", periodStart)
    .lte("shift_date", periodEnd)
    .is("archived_at", null)
    .neq("status", "cancelled")
    .order("shift_date")
    .order("start_time");
  if (shifts.error) throw new Error("Production rota data could not be loaded.");

  return (shifts.data ?? []).map((shift) => ({
    id: shift.id,
    staffId: shift.staff_id,
    shiftDate: shift.shift_date,
    startTime: String(shift.start_time).slice(0, 5),
    endTime: String(shift.end_time).slice(0, 5),
    breakMinutes: Number(shift.break_minutes),
    status: shift.status,
  }));
}
```

- [ ] **Step 4: Wire detail data into the route**

Load rota shifts in the existing `Promise.all`. Filter staff once, build payroll rows, then filter the detail staff to the IDs retained by the existing zero-hours choice:

```ts
const detail = createPayrollExportDetail({
  staff: includedStaff.filter((person) => includedIds.has(person.id)),
  shifts,
  events,
  reviews,
  periodStart,
  periodEnd,
});

const workbook = await createPayrollPreparationWorkbook(
  rows,
  periodStart,
  periodEnd,
  readiness,
  detail,
);
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/payroll-export.test.ts tests/payroll-export-detail.test.ts tests/payroll-review.test.ts
```

Expected: all focused export tests pass.

- [ ] **Step 6: Commit Task 3**

```powershell
git add src/lib/payroll/server.ts src/app/payroll/export/route.ts tests/payroll-export.test.ts
git commit -m "Connect rota data to payroll Excel export"
```

---

### Task 4: Full Verification and Production Delivery

**Files:**
- Verify all files changed in Tasks 1 to 3

- [ ] **Step 1: Inspect a generated workbook**

Use the workbook unit fixture to load the generated buffer with ExcelJS. Inspect:

- worksheet order;
- all planned dates;
- formula totals;
- a future rota-only daily row;
- original and manager event columns;
- numeric hour cells and number formats;
- unreviewed warning content.

- [ ] **Step 2: Run full repository verification**

Run:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected: all commands exit with status 0.

- [ ] **Step 3: Review the final diff**

Run:

```powershell
git diff --check
git status --short
git log --oneline -6
```

Confirm the unrelated pre-existing attendance migration and test changes remain uncommitted and unchanged by this feature.

- [ ] **Step 4: Merge and push**

Merge the isolated feature branch into `main` without staging unrelated workspace changes, then:

```powershell
git push origin main
```

- [ ] **Step 5: Verify Vercel production**

Confirm the production deployment for the pushed commit reaches `READY`. In the signed-in production app, export an unreviewed period and confirm the downloaded workbook contains:

- `Payroll Preparation`
- `Planned Rota`
- `Daily Clocking`
- `Read Me`

Verify that `Planned Rota` includes future dates in the period and `Daily Clocking` keeps original and manager correction events in separate columns.
