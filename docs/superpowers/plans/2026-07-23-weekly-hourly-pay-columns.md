# Weekly Hourly Pay Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable hourly pay and formula-driven estimated pay columns to every weekly payroll export worksheet.

**Architecture:** The existing `PayrollPreparationRow.hourlyRate` is the single source for the exported weekly rate. The workbook builder maps rates by staff ID, writes the rate as an editable numeric input, and writes an Excel formula for each planned or clocked weekly pay estimate.

**Tech Stack:** TypeScript, ExcelJS, Vitest, Next.js.

## Global Constraints

- Use UK date, time and currency formats and the Europe/London timezone.
- Do not calculate tax, PAYE, National Insurance, pensions or payslips.
- The estimate is decimal weekly hours multiplied by hourly pay only.
- Do not apply overtime multipliers in the weekly estimate.
- Hourly pay must remain an editable workbook input.
- A missing or salaried hourly rate must remain blank.
- Preserve original clock events and keep manager corrections separate.
- Do not add dependencies.
- Do not use em dashes in user-facing application copy.

---

## File map

- Modify `src/lib/exports/payroll-excel.ts`: append the two weekly columns, populate editable rates and write live formulas.
- Modify `tests/payroll-review.test.ts`: verify combined, planned-only, clocked-only, blank-rate and salaried-rate workbooks.

### Task 1: Weekly hourly pay and estimated pay formulas

**Files:**
- Modify: `src/lib/exports/payroll-excel.ts`
- Modify: `tests/payroll-review.test.ts`

**Interfaces:**
- Consumes: `PayrollPreparationRow.hourlyRate`, `PayrollPreparationRow.payType`, weekly total hours and existing export modes.
- Produces: weekly `Hourly pay` numeric or blank cells and `Estimated pay` Excel formulas with cached results.

- [ ] **Step 1: Write failing combined-layout assertions**

Extend the existing combined workbook test in `tests/payroll-review.test.ts`:

```ts
expect(week1.getCell("J2").value).toBe("Hourly pay");
expect(week1.getCell("K2").value).toBe("Estimated pay");
expect(week1.getCell("J3").value).toBe(12);
expect(week1.getCell("J3").isMerged).toBe(true);
expect(week1.getCell("K3").value).toEqual({
  formula: 'IF(J3="","",I3*J3)',
  result: 186,
});
expect(week1.getCell("K4").value).toEqual({
  formula: 'IF(J3="","",I4*J3)',
  result: 96,
});
expect(week1.getCell("J3").numFmt).toBe('"£"#,##0.00');
expect(week1.getCell("K3").numFmt).toBe('"£"#,##0.00');
```

- [ ] **Step 2: Write failing single-mode assertions**

Extend the planned-only test:

```ts
expect(week1.getCell("I2").value).toBe("Hourly pay");
expect(week1.getCell("J2").value).toBe("Estimated pay");
expect(week1.getCell("I3").value).toBe(12);
expect(week1.getCell("J3").value).toEqual({
  formula: 'IF(I3="","",H3*I3)',
  result: 186,
});
```

Extend the clocked-only test:

```ts
expect(week1.getCell("I3").value).toBe(12);
expect(week1.getCell("J3").value).toEqual({
  formula: 'IF(I3="","",H3*I3)',
  result: 96,
});
```

- [ ] **Step 3: Write failing blank and salaried rate tests**

Add:

```ts
it.each([
  { label: "missing", payrollRow: { ...preparation, hourlyRate: null } },
  {
    label: "salaried",
    payrollRow: {
      ...preparation,
      payType: "salaried" as const,
      hourlyRate: null,
    },
  },
])("leaves the $label hourly rate editable and blank", async ({ payrollRow }) => {
  const buffer = await createPayrollPreparationWorkbook(
    [payrollRow],
    "2026-07-01",
    "2026-07-10",
    { unresolved: 0, pendingRequests: 0 },
    weeklyDetail,
    { hours: "planned" },
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const week1 = workbook.getWorksheet("Week 1")!;

  expect(week1.getCell("I3").value).toBeNull();
  expect(week1.getCell("J3").value).toMatchObject({
    formula: 'IF(I3="","",H3*I3)',
  });
});
```

- [ ] **Step 4: Run the workbook test and verify RED**

Run:

```powershell
npm.cmd test -- tests/payroll-review.test.ts --reporter=dot
```

Expected: FAIL because weekly sheets currently end at `Weekly total`.

- [ ] **Step 5: Map effective hourly rates by staff**

In `src/lib/exports/payroll-excel.ts`, before building weekly worksheets:

```ts
const hourlyRateByStaffId = new Map(
  rows.map((row) => [
    row.staffId,
    row.payType === "hourly" ? row.hourlyRate : null,
  ]),
);
```

- [ ] **Step 6: Append the pay columns and extend the note merge**

For each weekly worksheet:

```ts
const hourlyPayColumnNumber = totalColumnNumber + 1;
const estimatedPayColumnNumber = totalColumnNumber + 2;
```

Merge the note through `estimatedPayColumnNumber` and append:

```ts
"Weekly total",
"Hourly pay",
"Estimated pay",
```

Each generated data row must include three trailing nulls: weekly total, hourly pay
and estimated pay.

- [ ] **Step 7: Add a formula helper with cached results**

Inside the staff loop, after `firstDateColumn` and `lastDateColumn` are known:

```ts
const hourlyRate = hourlyRateByStaffId.get(staffRow.staffId) ?? null;
const plannedTotalHours = decimalHours(
  plannedMinutes.reduce((sum, minutes) => sum + minutes, 0),
);
const clockedTotalHours = decimalHours(
  clockedMinutes.reduce((sum, minutes) => sum + minutes, 0),
);

const setPayCells = (
  row: ExcelJS.Row,
  totalHours: number,
  hourlyRateRowNumber: number,
) => {
  const totalCell = row.getCell(totalColumnNumber);
  const rateCell = row.getCell(hourlyPayColumnNumber);
  const estimatedCell = row.getCell(estimatedPayColumnNumber);
  const totalReference = totalCell.address;
  const rateReference =
    weekly.getCell(hourlyRateRowNumber, hourlyPayColumnNumber).address;

  estimatedCell.value = {
    formula: `IF(${rateReference}="","",${totalReference}*${rateReference})`,
    result:
      hourlyRate === null
        ? ""
        : Math.round(totalHours * hourlyRate * 100) / 100,
  };
};
```

For single-mode rows, set the row's hourly pay cell to `hourlyRate` and call
`setPayCells(row, plannedTotalHours, row.number)` or
`setPayCells(row, clockedTotalHours, row.number)`.

For combined rows:

1. set the planned row's hourly pay cell to `hourlyRate`;
2. merge the hourly pay column from planned row to clocked row;
3. call `setPayCells(plannedRow, plannedTotalHours, plannedRow.number)`;
4. call `setPayCells(clockedRow, clockedTotalHours, plannedRow.number)`.

- [ ] **Step 8: Apply currency formatting and widths**

For every weekly sheet:

```ts
weekly.getColumn(hourlyPayColumnNumber).width = 15;
weekly.getColumn(estimatedPayColumnNumber).width = 17;
weekly.getColumn(hourlyPayColumnNumber).numFmt = '"£"#,##0.00';
weekly.getColumn(estimatedPayColumnNumber).numFmt = '"£"#,##0.00';
```

Keep `Weekly total` formatted as `0.00`.

- [ ] **Step 9: Update workbook guidance**

Extend the weekly note with:

```text
Hourly pay is editable. Estimated pay is weekly hours multiplied by hourly pay and is not completed payroll.
```

Add equivalent concise guidance to `Read Me`. Do not mention tax calculations as
being included.

- [ ] **Step 10: Run the focused tests and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/payroll-review.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

```powershell
git add -- src/lib/exports/payroll-excel.ts tests/payroll-review.test.ts
git commit -m "Add weekly hourly pay estimates"
```

### Task 2: Full verification and deployment

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: all three workbook export modes with numeric, blank and salaried rates.
- Produces: a production deployment verified through a real planned-only download.

- [ ] **Step 1: Run the required code quality gates**

Run:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test -- --reporter=dot
npm.cmd run build
```

Expected: every command exits 0.

- [ ] **Step 2: Generate and inspect representative workbooks**

Generate combined, planned-only and clocked-only workbooks containing one hourly
employee and one employee without an hourly rate. Inspect:

- sheet names and weekly header positions;
- rate values and blank cells;
- planned and clocked formula references;
- cached estimated pay results;
- merged combined-rate cells;
- UK pound number formats;
- formula errors.

Render at least one weekly sheet from each mode and confirm the appended columns are
legible and not clipped.

- [ ] **Step 3: Merge and push**

Preserve the existing unrelated migration and attendance-test edits. Merge the tested
feature commit to `main` and push without modifying those files.

- [ ] **Step 4: Verify production**

Wait for Vercel to report the pushed commit as `READY`. From the signed-in production
pay preparation page, download a planned-only July export and inspect the actual
workbook:

- every week ends with `Weekly total`, `Hourly pay`, `Estimated pay`;
- known hourly rates are populated and missing rates are blank;
- the estimated pay cells contain the expected live formulas and cached results;
- there are no spreadsheet formula errors.

- [ ] **Step 5: Report completion**

Report the production URL, deployed commit and fresh verification counts. Do not
claim completion until all preceding checks have current evidence.
