# Weekly Payroll Hours Worksheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wide monthly planned-rota worksheet with numbered Monday-to-Sunday weekly worksheets containing planned and raw clocked sub-rows plus immediately visible weekly totals.

**Architecture:** Reuse `PayrollExportDetail` as the single workbook input. Add a pure week-splitting helper beside the existing export-detail calculations, then have the ExcelJS builder create one worksheet per week from `plannedRows` and each daily row's `rawWorkedMinutes`.

**Tech Stack:** TypeScript, date-fns, ExcelJS, Vitest, Next.js

## Global Constraints

- Weeks follow the UK Monday-to-Sunday calendar.
- Planned hours deduct planned rota breaks.
- Clocked hours use original completed clock-in/out sessions and exclude clocked-out breaks.
- Manager correction events do not affect raw weekly clocked hours.
- Weekly total cells contain both a formula and its calculated export-time result.
- Preserve `Daily Clocking`, `Read Me`, manager permissions and unreviewed-export confirmation.
- Use UK date, time and currency formats and the Europe/London timezone.
- Do not calculate tax, PAYE, National Insurance, pensions or payslips.
- Do not add a runtime dependency.
- Do not use em dashes in user-facing application copy.

---

### Task 1: Split Export Dates into UK Calendar Weeks

**Files:**
- Modify: `src/lib/exports/payroll-detail.ts`
- Modify: `tests/payroll-export-detail.test.ts`

**Interfaces:**
- Produces: `splitPayrollDatesIntoWeeks(dates: string[]): string[][]`
- Retains: `createPayrollExportDetail(...) => PayrollExportDetail`

- [ ] **Step 1: Add failing week-boundary and unpaid-break tests**

Add:

```ts
expect(splitPayrollDatesIntoWeeks([
  "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05",
  "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
])).toEqual([
  ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"],
  ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"],
]);
```

Add a daily fixture with original sessions `08:00-12:00` and `13:00-17:00`, then assert `rawWorkedMinutes` is `480`, proving the clocked-out one-hour break is excluded. Add manager correction events and retain the existing assertion that they do not change `rawWorkedMinutes`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd test -- tests/payroll-export-detail.test.ts
```

Expected: FAIL because `splitPayrollDatesIntoWeeks` does not exist.

- [ ] **Step 3: Implement the week splitter**

Add to `src/lib/exports/payroll-detail.ts`:

```ts
export function splitPayrollDatesIntoWeeks(dates: string[]): string[][] {
  const weeks: string[][] = [];
  for (const date of dates) {
    const weekKey = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const current = weeks.at(-1);
    if (!current || format(startOfWeek(parseISO(current[0]), { weekStartsOn: 1 }), "yyyy-MM-dd") !== weekKey) {
      weeks.push([date]);
    } else {
      current.push(date);
    }
  }
  return weeks;
}
```

Import `startOfWeek` from `date-fns`. The helper preserves the selected-period order and naturally creates partial first and final weeks.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/payroll-export-detail.test.ts
```

Expected: all export-detail tests pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/lib/exports/payroll-detail.ts tests/payroll-export-detail.test.ts
git commit -m "Split payroll export dates into UK weeks"
```

---

### Task 2: Create Numbered Weekly Worksheets with Visible Totals

**Files:**
- Modify: `src/lib/exports/payroll-excel.ts`
- Modify: `tests/payroll-review.test.ts`

**Interfaces:**
- Consumes: `splitPayrollDatesIntoWeeks(detail.dates)`
- Produces workbook order: `Pay Summary`, `Week 1` through `Week N`, `Daily Clocking`, `Read Me`

- [ ] **Step 1: Replace the old workbook assertions with failing weekly-layout assertions**

Create a ten-day detail fixture covering Wednesday 1 July through Friday 10 July 2026. Assert:

```ts
expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
  "Pay Summary",
  "Week 1",
  "Week 2",
  "Daily Clocking",
  "Read Me",
]);

const week1 = workbook.getWorksheet("Week 1")!;
expect(week1.getCell("D2").value).toBe("Wed 01/07");
expect(week1.getCell("H2").value).toBe("Sun 05/07");
expect(week1.getCell("C3").value).toBe("Planned hours");
expect(week1.getCell("C4").value).toBe("Clocked hours");
expect(week1.getCell("I3").value).toEqual({ formula: "SUM(D3:H3)", result: 15.5 });
expect(week1.getCell("I4").value).toEqual({ formula: "SUM(D4:H4)", result: 8 });
expect(week1.getCell("I3").numFmt).toBe("0.00");
expect(week1.getCell("A3").isMerged).toBe(true);
expect(week1.views[0]).toMatchObject({ state: "frozen", xSplit: 3, ySplit: 2 });
expect(workbook.getWorksheet("Planned Rota")).toBeUndefined();
expect(workbook.calcProperties.fullCalcOnLoad).toBe(true);
```

Assert `Week 2` begins with `Mon 06/07`, has its own weekly-total formula and cached result, and the existing `Daily Clocking` and `Read Me` worksheets remain.

- [ ] **Step 2: Run the workbook test and verify RED**

Run:

```powershell
npm.cmd test -- tests/payroll-review.test.ts
```

Expected: FAIL because the workbook still contains `Payroll Preparation` and `Planned Rota`.

- [ ] **Step 3: Rename the summary and enable recalculation**

In `createPayrollPreparationWorkbook`:

```ts
workbook.calcProperties.fullCalcOnLoad = true;
workbook.calcProperties.forceFullCalc = true;

const sheet = workbook.addWorksheet("Pay Summary", {
  views: [{ state: "frozen", ySplit: 1 }],
});
```

- [ ] **Step 4: Replace the Planned Rota block with numbered weekly worksheets**

For each result of `splitPayrollDatesIntoWeeks(detail.dates)`, create `Week ${index + 1}` with columns `Staff name`, `Role`, `Hours type`, the dates for that week and `Weekly total`.

For every `plannedRow`, add two adjacent rows:

```ts
const plannedValues = weekDates.map(
  (date) => decimalHours(plannedRow.plannedMinutesByDate[date] ?? 0),
);
const clockedValues = weekDates.map((date) =>
  decimalHours(
    detail.dailyRows.find(
      (row) => row.staffId === plannedRow.staffId && row.date === date,
    )?.rawWorkedMinutes ?? 0,
  ),
);
```

Merge staff name and role cells vertically across the pair. Set the planned total cell to:

```ts
{
  formula: `SUM(${firstDateColumn}${plannedRowNumber}:${lastDateColumn}${plannedRowNumber})`,
  result: decimalHours(
    weekDates.reduce(
      (sum, date) => sum + (plannedRow.plannedMinutesByDate[date] ?? 0),
      0,
    ),
  ),
}
```

Set the clocked total cell the same way using summed `rawWorkedMinutes`. Apply `0.00` number formats, purple headers, alternating planned/clocked fills, frozen panes `{ xSplit: 3, ySplit: 2 }`, landscape page setup and fit-to-one-page-wide.

- [ ] **Step 5: Extend Read Me**

Add these rows:

```ts
["Each numbered worksheet covers one Monday-to-Sunday week within the selected period."],
["Planned hours deduct planned rota breaks."],
["Clocked hours sum original completed clock-in/out sessions. Clocked-out breaks are unpaid."],
```

- [ ] **Step 6: Run the workbook tests and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/payroll-review.test.ts tests/payroll-export-detail.test.ts
```

Expected: all weekly workbook and export-detail tests pass.

- [ ] **Step 7: Commit Task 2**

```powershell
git add src/lib/exports/payroll-excel.ts tests/payroll-review.test.ts
git commit -m "Create weekly payroll hours worksheets"
```

---

### Task 3: Full Verification and Production Delivery

**Files:**
- Verify all files modified in Tasks 1 and 2

- [ ] **Step 1: Generate and inspect a realistic workbook**

Generate a ten-day workbook fixture. Load it with ExcelJS and the supported spreadsheet inspection runtime. Confirm:

- worksheet order and numbering;
- partial Wednesday-to-Sunday `Week 1`;
- Monday start for `Week 2`;
- two sub-rows per employee;
- clocked-out breaks excluded;
- cached weekly totals visible;
- formula ranges correct;
- no formula errors;
- all worksheet layouts render legibly.

- [ ] **Step 2: Run full repository verification**

Run:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected: all commands exit with status 0.

- [ ] **Step 3: Review and integrate**

Run:

```powershell
git diff --check
git status --short
git log --oneline -6
```

Merge the isolated feature branch into `main` without staging the unrelated attendance changes. Run the full tests on the merged result, then push:

```powershell
git push origin main
```

- [ ] **Step 4: Verify production**

Wait for the Vercel deployment for the pushed commit to reach `READY`. Download the live July workbook and verify:

- `Pay Summary`;
- `Week 1` through `Week 5`;
- `Daily Clocking`;
- `Read Me`;
- visible planned and clocked weekly totals; and
- no `Planned Rota` worksheet.
