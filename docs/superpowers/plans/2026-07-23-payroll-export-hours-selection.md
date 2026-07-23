# Payroll Export Hours Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manager-selectable planned, clocked, or combined payroll Excel export while keeping the combined workbook as the default.

**Architecture:** A focused export-options module owns parsing and mode predicates. The pay preparation client sends the selected mode, the route validates it and applies mode-aware confirmation and staff filtering, and the Excel builder conditionally creates support sheets and weekly row layouts.

**Tech Stack:** Next.js App Router, React, TypeScript, ExcelJS, Vitest, Tailwind CSS.

## Global Constraints

- Use UK date, time and currency formats and the Europe/London timezone.
- Do not calculate tax, PAYE, National Insurance, pensions or payslips.
- Preserve original clock events and keep manager corrections separate.
- Do not expose salary or pay-rate information on the public clocking kiosk.
- Keep touch targets large and workflows simple for non-technical users.
- Do not add dependencies.
- Do not use em dashes in user-facing application copy.
- Missing or invalid export modes must fall back to `both`.
- The default workbook behaviour must remain the current combined export.

---

## File map

- Create `src/lib/exports/payroll-options.ts`: typed parsing and mode predicates.
- Create `tests/payroll-export-options.test.ts`: direct unit tests for parsing and inclusion decisions.
- Modify `src/app/payroll/export/route.ts`: parse the mode, enforce the correct confirmation policy, filter staff by relevant hours, and pass workbook options.
- Modify `src/lib/exports/payroll-excel.ts`: conditionally create support sheets and weekly row layouts.
- Modify `src/components/payroll/production-payroll-screen.tsx`: render and submit the manager selector.
- Modify `tests/payroll-review.test.ts`: verify the three concrete workbook layouts.
- Modify `tests/payroll-export.test.ts`: verify route and screen integration.

### Task 1: Typed export modes and route policy

**Files:**
- Create: `src/lib/exports/payroll-options.ts`
- Create: `tests/payroll-export-options.test.ts`
- Modify: `src/app/payroll/export/route.ts`
- Test: `tests/payroll-export-options.test.ts`
- Test: `tests/payroll-export.test.ts`

**Interfaces:**
- Produces: `PayrollExportHoursMode = "both" | "planned" | "clocked"`.
- Produces: `parsePayrollExportHoursMode(params: URLSearchParams): PayrollExportHoursMode`.
- Produces: `payrollModeIncludesPlanned(mode): boolean`.
- Produces: `payrollModeIncludesClocked(mode): boolean`.
- Produces: `payrollRowHasSelectedHours(mode, adjustedMinutes, plannedMinutes): boolean`.

- [ ] **Step 1: Write failing option-parser tests**

Create `tests/payroll-export-options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parsePayrollExportHoursMode,
  payrollModeIncludesClocked,
  payrollModeIncludesPlanned,
  payrollRowHasSelectedHours,
} from "@/lib/exports/payroll-options";

describe("payroll export hours options", () => {
  it.each([
    ["planned", "planned"],
    ["clocked", "clocked"],
    ["both", "both"],
    [null, "both"],
    ["unexpected", "both"],
  ])("parses %s as %s", (value, expected) => {
    const params = new URLSearchParams();
    if (value !== null) params.set("hours", value);
    expect(parsePayrollExportHoursMode(params)).toBe(expected);
  });

  it("reports which data each mode contains", () => {
    expect(payrollModeIncludesPlanned("planned")).toBe(true);
    expect(payrollModeIncludesClocked("planned")).toBe(false);
    expect(payrollModeIncludesPlanned("clocked")).toBe(false);
    expect(payrollModeIncludesClocked("clocked")).toBe(true);
    expect(payrollModeIncludesPlanned("both")).toBe(true);
    expect(payrollModeIncludesClocked("both")).toBe(true);
  });

  it("uses the selected hours when excluding zero-hour staff", () => {
    expect(payrollRowHasSelectedHours("planned", 0, 420)).toBe(true);
    expect(payrollRowHasSelectedHours("planned", 60, 0)).toBe(false);
    expect(payrollRowHasSelectedHours("clocked", 60, 0)).toBe(true);
    expect(payrollRowHasSelectedHours("clocked", 0, 420)).toBe(false);
    expect(payrollRowHasSelectedHours("both", 0, 420)).toBe(true);
    expect(payrollRowHasSelectedHours("both", 60, 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run:

```powershell
npm.cmd test -- tests/payroll-export-options.test.ts --reporter=dot
```

Expected: FAIL because `@/lib/exports/payroll-options` does not exist.

- [ ] **Step 3: Implement the focused options module**

Create `src/lib/exports/payroll-options.ts`:

```ts
export type PayrollExportHoursMode = "both" | "planned" | "clocked";

export function parsePayrollExportHoursMode(
  params: URLSearchParams,
): PayrollExportHoursMode {
  const value = params.get("hours");
  return value === "planned" || value === "clocked" || value === "both"
    ? value
    : "both";
}

export const payrollModeIncludesPlanned = (mode: PayrollExportHoursMode) =>
  mode !== "clocked";

export const payrollModeIncludesClocked = (mode: PayrollExportHoursMode) =>
  mode !== "planned";

export function payrollRowHasSelectedHours(
  mode: PayrollExportHoursMode,
  clockedMinutes: number,
  plannedMinutes: number,
) {
  return (
    (payrollModeIncludesClocked(mode) && clockedMinutes > 0) ||
    (payrollModeIncludesPlanned(mode) && plannedMinutes > 0)
  );
}
```

- [ ] **Step 4: Run the parser tests and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/payroll-export-options.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 5: Add failing route-policy assertions**

Extend `tests/payroll-export.test.ts` to require:

```ts
expect(route).toContain("parsePayrollExportHoursMode(params)");
expect(route).toContain("payrollModeIncludesClocked(hoursMode)");
expect(route).toContain("payrollRowHasSelectedHours");
expect(route).toContain("{ hours: hoursMode }");
```

Change the confirmation assertion so the guard also requires clocked hours:

```ts
expect(route).toMatch(
  /payrollModeIncludesClocked\(hoursMode\)[\s\S]*readiness\.unresolved[\s\S]*!confirmUnreviewed/,
);
```

- [ ] **Step 6: Run the route test and verify RED**

Run:

```powershell
npm.cmd test -- tests/payroll-export.test.ts --reporter=dot
```

Expected: FAIL because the route has no export-hours mode.

- [ ] **Step 7: Implement mode-aware route data flow**

In `src/app/payroll/export/route.ts`:

1. Parse `hoursMode` with `parsePayrollExportHoursMode(params)`.
2. Require `confirmUnreviewed` only when `payrollModeIncludesClocked(hoursMode)` is true.
3. Build preparation rows and export detail for all staff passing the inactive/manager filters.
4. Sum each staff member's planned minutes from `detail.plannedRows`.
5. When `includeZero` is false, retain staff via
   `payrollRowHasSelectedHours(hoursMode, row.adjustedMinutes, plannedMinutes)`.
6. Filter both `rows`, `detail.plannedRows`, and `detail.dailyRows` to the retained IDs.
7. Pass `{ hours: hoursMode }` as the sixth workbook argument.

The route must keep existing filenames, authorisation, and private no-store headers.

- [ ] **Step 8: Run route and option tests**

Run:

```powershell
npm.cmd test -- tests/payroll-export-options.test.ts tests/payroll-export.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```powershell
git add -- src/lib/exports/payroll-options.ts src/app/payroll/export/route.ts tests/payroll-export-options.test.ts tests/payroll-export.test.ts
git commit -m "Add payroll export hours options"
```

### Task 2: Conditional workbook layouts

**Files:**
- Modify: `src/lib/exports/payroll-excel.ts`
- Modify: `tests/payroll-review.test.ts`

**Interfaces:**
- Consumes: `PayrollExportHoursMode` and mode predicates from Task 1.
- Produces: `PayrollWorkbookOptions = { hours: PayrollExportHoursMode }`.
- Produces: optional sixth argument to `createPayrollPreparationWorkbook`.

- [ ] **Step 1: Write failing planned-only workbook test**

In `tests/payroll-review.test.ts`, call:

```ts
const buffer = await createPayrollPreparationWorkbook(
  [preparation],
  "2026-07-01",
  "2026-07-10",
  { unresolved: 12, pendingRequests: 0 },
  weeklyDetail,
  { hours: "planned" },
);
```

Assert:

```ts
expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
  "Week 1",
  "Week 2",
  "Read Me",
]);
expect(workbook.getWorksheet("Pay Summary")).toBeUndefined();
expect(workbook.getWorksheet("Daily Clocking")).toBeUndefined();
expect(workbook.getWorksheet("Week 1")?.getCell("C2").value).toBe("Wed 01/07");
expect(workbook.getWorksheet("Week 1")?.getCell("A3").value).toBe("Staff Member");
expect(workbook.getWorksheet("Week 1")?.getCell("H3").value).toEqual({
  formula: "SUM(C3:G3)",
  result: 15.5,
});
expect(workbook.getWorksheet("Week 1")?.getColumn(2).values).not.toContain(
  "Hours type",
);
```

- [ ] **Step 2: Run the planned-only test and verify RED**

Run the single new test with:

```powershell
npm.cmd test -- tests/payroll-review.test.ts --reporter=dot
```

Expected: FAIL because the workbook builder ignores the sixth argument and creates
the combined layout.

- [ ] **Step 3: Add workbook options and planned-only layout**

In `src/lib/exports/payroll-excel.ts`:

```ts
export type PayrollWorkbookOptions = {
  hours: PayrollExportHoursMode;
};
```

Add a sixth argument with a backward-compatible default:

```ts
options: PayrollWorkbookOptions = { hours: "both" },
```

Create `Pay Summary` only when clocked hours are included. Build weekly headers from
`["Staff name", "Role"]`, add `"Hours type"` only in both mode, then dates and
`"Weekly total"`. In planned-only mode add one planned row per staff member, without
vertical merges, and calculate its formula across the actual date columns.

- [ ] **Step 4: Run the planned-only test and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/payroll-review.test.ts --reporter=dot
```

Expected: PASS for planned-only and all existing combined tests.

- [ ] **Step 5: Write failing clocked-only workbook test**

Add a test using `{ hours: "clocked" }` and assert:

```ts
expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
  "Pay Summary",
  "Week 1",
  "Week 2",
  "Daily Clocking",
  "Read Me",
]);
expect(workbook.getWorksheet("Week 1")?.getCell("C2").value).toBe("Wed 01/07");
expect(workbook.getWorksheet("Week 1")?.getCell("H3").value).toEqual({
  formula: "SUM(C3:G3)",
  result: 8,
});
expect(workbook.getWorksheet("Week 1")?.getColumn(2).values).not.toContain(
  "Hours type",
);
```

- [ ] **Step 6: Run the clocked-only test and verify RED**

Run:

```powershell
npm.cmd test -- tests/payroll-review.test.ts --reporter=dot
```

Expected: FAIL because clocked-only still uses the combined weekly layout.

- [ ] **Step 7: Implement clocked-only rows and support-sheet selection**

Use the same single-row weekly layout for clocked-only mode, populated from
`rawMinutesByStaffDate`. Create `Daily Clocking` only when clocked hours are
included. Keep current merged two-subrow behaviour and frozen panes for `both`.
Freeze two identifying columns for single-mode sheets and three for `both`.

Update `Read Me` so it names the selected mode and only explains calculations that
are present in the workbook.

- [ ] **Step 8: Run workbook tests and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/payroll-review.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```powershell
git add -- src/lib/exports/payroll-excel.ts tests/payroll-review.test.ts
git commit -m "Create selected payroll workbook layouts"
```

### Task 3: Manager export selector

**Files:**
- Modify: `src/components/payroll/production-payroll-screen.tsx`
- Modify: `tests/payroll-export.test.ts`

**Interfaces:**
- Consumes: `PayrollExportHoursMode`.
- Sends: query parameter `hours=both|planned|clocked`.

- [ ] **Step 1: Write failing interface assertions**

Extend `tests/payroll-export.test.ts`:

```ts
expect(screen).toContain('label="Hours to include"');
expect(screen).toContain("Both planned and clocked");
expect(screen).toContain("Planned hours only");
expect(screen).toContain("Clocked hours only");
expect(screen).toContain("hours: exportHours");
expect(screen).toContain('exportHours !== "planned"');
```

- [ ] **Step 2: Run the interface test and verify RED**

Run:

```powershell
npm.cmd test -- tests/payroll-export.test.ts --reporter=dot
```

Expected: FAIL because the selector and query field do not exist.

- [ ] **Step 3: Implement the accessible selector**

In `src/components/payroll/production-payroll-screen.tsx`:

```ts
const [exportHours, setExportHours] =
  useState<PayrollExportHoursMode>("both");
```

Add a labelled native select near the export actions:

```tsx
<Field label="Hours to include">
  <select
    className={inputClassName()}
    value={exportHours}
    onChange={(event) =>
      setExportHours(event.target.value as PayrollExportHoursMode)
    }
  >
    <option value="both">Both planned and clocked</option>
    <option value="planned">Planned hours only</option>
    <option value="clocked">Clocked hours only</option>
  </select>
</Field>
```

Add `hours: exportHours` to the download query. Open the warning only when attendance
is incomplete and `exportHours !== "planned"`. Use the same condition for rendering
the warning so switching to planned mode cannot leave a stale confirmation panel.

- [ ] **Step 4: Run interface and route tests**

Run:

```powershell
npm.cmd test -- tests/payroll-export.test.ts tests/payroll-export-options.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- src/components/payroll/production-payroll-screen.tsx tests/payroll-export.test.ts
git commit -m "Add payroll export hours selector"
```

### Task 4: Full verification and deployment

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: the complete selector-to-workbook flow.
- Produces: a production deployment verified with real downloads.

- [ ] **Step 1: Run all required quality gates**

Run:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test -- --reporter=dot
npm.cmd run build
```

Expected: every command exits 0.

- [ ] **Step 2: Generate and inspect representative workbooks**

Generate `both`, `planned`, and `clocked` workbooks with realistic July data. Inspect
sheet names, headers, formulas, cached results, frozen panes, and formula errors.
Render at least one numbered week from each mode and visually confirm that rows and
totals are legible.

- [ ] **Step 3: Merge and push**

Preserve the existing unrelated migration and attendance-test edits. Merge the tested
feature commits to `main` and push without modifying those files.

- [ ] **Step 4: Verify the production deployment**

Wait for Vercel to report the pushed commit as `READY`. In the signed-in production
pay preparation page:

1. Download a planned-only July export and verify it contains `Week 1` through
   `Week 5` plus `Read Me`, without an unreviewed-attendance confirmation.
2. Download a clocked-only July export and verify it requires confirmation and
   contains `Pay Summary`, `Week 1` through `Week 5`, `Daily Clocking`, and `Read Me`.
3. Verify the weekly rows, date boundaries, formulas, cached totals, and absence of
   spreadsheet formula errors.

- [ ] **Step 5: Report completion**

Report the production URL, deployed commit, verification counts, and the exact
workbook layouts. Do not claim success before all preceding checks have fresh
evidence.
