# Unreviewed Payroll Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers explicitly confirm and export an Excel payroll-preparation workbook when attendance reviews are incomplete, without changing attendance or review records.

**Architecture:** Keep the existing manager-only export route and its independent readiness query. Add an explicit `confirmUnreviewed=1` request flag for incomplete exports, pass readiness metadata into the workbook builder, and present an accessible inline confirmation panel in the payroll screen. Reviewed exports continue through the existing one-click path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, ExcelJS, Vitest, Tailwind CSS

## Global Constraints

- Use UK date, time and currency formats.
- Use the Europe/London timezone.
- Do not calculate tax, PAYE, National Insurance, pensions or payslips.
- Preserve original clock events.
- Manager corrections must remain separate from original clock records.
- Do not alter attendance review decisions or staff correction requests during export.
- Do not silently overwrite historic hourly rates or salary values.
- Keep all payroll and pay-rate information inside manager-only routes.
- Do not delete or change demo export functionality.
- Do not add dependencies.
- Do not use em dashes in user-facing application copy.
- Preserve unrelated working-tree changes in attendance migrations and tests.

---

### Task 1: Permit Explicitly Confirmed Incomplete Exports

**Files:**
- Create: `tests/payroll-export.test.ts`
- Modify: `src/app/payroll/export/route.ts`

**Interfaces:**
- Consumes: `loadAttendanceReviewReadiness(periodStart, periodEnd): Promise<{ unresolved: number; pendingRequests: number }>`
- Produces: the `confirmUnreviewed=1` query contract used by the payroll screen

- [ ] **Step 1: Write the failing route-policy test**

Create `tests/payroll-export.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("payroll export confirmation policy", () => {
  it("allows incomplete attendance only after explicit manager confirmation", () => {
    const route = source("src/app/payroll/export/route.ts");

    expect(route).toContain('params.get("confirmUnreviewed") === "1"');
    expect(route).toMatch(
      /if \(\(readiness\.unresolved > 0 \|\| readiness\.pendingRequests > 0\) && !confirmUnreviewed\)/,
    );
    expect(route).toContain("Confirm the unreviewed payroll export before downloading.");
    expect(route).toContain('requireAccount(["manager"])');
  });
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```powershell
npm.cmd test -- tests/payroll-export.test.ts
```

Expected: FAIL because `src/app/payroll/export/route.ts` does not read `confirmUnreviewed`.

- [ ] **Step 3: Implement the explicit server-side confirmation**

In `src/app/payroll/export/route.ts`, read the flag next to the existing filters:

```ts
const includeInactive = params.get("inactive") === "1";
const includeManagers = params.get("managers") === "1";
const includeZero = params.get("zero") !== "0";
const confirmUnreviewed = params.get("confirmUnreviewed") === "1";
```

Replace the unconditional readiness block with:

```ts
if ((readiness.unresolved > 0 || readiness.pendingRequests > 0) && !confirmUnreviewed) {
  return NextResponse.json(
    { error: "Confirm the unreviewed payroll export before downloading." },
    { status: 409 },
  );
}
```

Do not remove `requireAccount(["manager"])`, the date validation, or the readiness query.

- [ ] **Step 4: Run the focused test**

Run:

```powershell
npm.cmd test -- tests/payroll-export.test.ts
```

Expected: PASS, 1 test.

- [ ] **Step 5: Commit only the route and its test**

```powershell
git add -- "tests/payroll-export.test.ts" "src/app/payroll/export/route.ts"
git commit -m "Allow confirmed unreviewed payroll exports"
```

---

### Task 2: Label Unreviewed Workbooks

**Files:**
- Modify: `tests/payroll-review.test.ts`
- Modify: `src/lib/exports/payroll-excel.ts`
- Modify: `src/app/payroll/export/route.ts`

**Interfaces:**
- Consumes: readiness metadata `{ unresolved: number; pendingRequests: number }`
- Produces: `PayrollWorkbookReviewState` and an optional fourth argument to `createPayrollPreparationWorkbook`

- [ ] **Step 1: Add workbook regression tests**

In `tests/payroll-review.test.ts`, move the existing preparation fixture to the start of the `payroll Excel export` describe block:

```ts
const preparation: PayrollPreparationRow = {
  staffId: "staff",
  fullName: "Staff Member",
  employmentRole: "Practitioner",
  payType: "hourly",
  contractedWeeklyHours: 35,
  hoursBasis: "contracted",
  recordedMinutes: 450,
  adjustedMinutes: 480,
  ordinaryMinutes: 480,
  overtimeMinutes: 0,
  hourlyRate: 12,
  estimatedGross: 96,
  salaryBasis: null,
  workedDays: 1,
  reviewedDays: 1,
  unresolvedDays: 0,
  reviewStatus: "ready",
  adjustmentNotes: ["Manager correction events included"],
  warnings: ["Manager correction"],
};
```

Remove the duplicate fixture from inside the existing test, retain that test, and add:

```ts
it("labels incomplete attendance as unreviewed and includes readiness counts", async () => {
  const buffer = await createPayrollPreparationWorkbook(
    [preparation],
    "2026-06-01",
    "2026-06-30",
    { unresolved: 12, pendingRequests: 2 },
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const readMe = workbook.getWorksheet("Read Me");
  const values = readMe?.getColumn(1).values.map(String).join(" ") ?? "";
  expect(values).toContain("UNREVIEWED PAYROLL PREPARATION");
  expect(values).toContain("12 worked day(s) are not reviewed");
  expect(values).toContain("2 staff correction request(s) remain open");
  expect(values).toContain("Check and correct these hours manually");
});

it("keeps the normal label when attendance is fully reviewed", async () => {
  const buffer = await createPayrollPreparationWorkbook(
    [preparation],
    "2026-06-01",
    "2026-06-30",
    { unresolved: 0, pendingRequests: 0 },
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  expect(workbook.getWorksheet("Read Me")?.getCell("A1").value).toBe(
    "Jan Pre-School payroll preparation",
  );
});
```

- [ ] **Step 2: Run the workbook tests and verify the expected failure**

Run:

```powershell
npm.cmd test -- tests/payroll-review.test.ts
```

Expected: FAIL because `createPayrollPreparationWorkbook` accepts only three arguments and does not write readiness warnings.

- [ ] **Step 3: Add the workbook review-state interface**

In `src/lib/exports/payroll-excel.ts`, add:

```ts
export type PayrollWorkbookReviewState = {
  unresolved: number;
  pendingRequests: number;
};
```

Change the function signature to:

```ts
export async function createPayrollPreparationWorkbook(
  rows: PayrollPreparationRow[],
  periodStart: string,
  periodEnd: string,
  reviewState: PayrollWorkbookReviewState = { unresolved: 0, pendingRequests: 0 },
): Promise<Buffer> {
```

- [ ] **Step 4: Write reviewed and unreviewed Read Me content**

Before creating the `Read Me` worksheet, calculate:

```ts
const isUnreviewed = reviewState.unresolved > 0 || reviewState.pendingRequests > 0;
const workbookLabel = isUnreviewed
  ? "UNREVIEWED PAYROLL PREPARATION"
  : "Jan Pre-School payroll preparation";
```

Replace the existing `notes.addRows` call with:

```ts
notes.addRows([
  [workbookLabel],
  [`Period: ${periodStart} to ${periodEnd}`],
  ...(isUnreviewed
    ? [
        [`${reviewState.unresolved} worked day(s) are not reviewed.`],
        [`${reviewState.pendingRequests} staff correction request(s) remain open.`],
        ["Check and correct these hours manually before using them for payroll."],
      ]
    : [["This workbook contains manager-reviewed preparation figures only."]]),
  ["It does not calculate PAYE, National Insurance, pensions, student loans or payslips."],
  ["Original clock events remain unchanged. Manager correction events and review notes are shown separately."],
]);
```

Set workbook metadata immediately after calculating the label:

```ts
workbook.subject = workbookLabel;
```

- [ ] **Step 5: Pass readiness metadata from the export route**

In `src/app/payroll/export/route.ts`, change the workbook call to:

```ts
const workbook = await createPayrollPreparationWorkbook(
  rows,
  periodStart,
  periodEnd,
  readiness,
);
```

Use an unreviewed filename when necessary:

```ts
const unreviewedPrefix =
  readiness.unresolved > 0 || readiness.pendingRequests > 0 ? "unreviewed-" : "";
```

Then set:

```ts
"Content-Disposition": `attachment; filename="jan-${unreviewedPrefix}payroll-preparation-${periodStart}-to-${periodEnd}.xlsx"`,
```

- [ ] **Step 6: Run the workbook and route tests**

Run:

```powershell
npm.cmd test -- tests/payroll-review.test.ts tests/payroll-export.test.ts
```

Expected: PASS for both test files.

- [ ] **Step 7: Commit the workbook labelling**

```powershell
git add -- "tests/payroll-review.test.ts" "src/lib/exports/payroll-excel.ts" "src/app/payroll/export/route.ts"
git commit -m "Label unreviewed payroll workbooks"
```

---

### Task 3: Add the Manager Confirmation Panel

**Files:**
- Modify: `tests/payroll-export.test.ts`
- Modify: `src/components/payroll/production-payroll-screen.tsx`

**Interfaces:**
- Consumes: `reviewReadiness: { unresolved: number; pendingRequests: number }`
- Produces: requests with `confirmUnreviewed=1` only after the manager confirms

- [ ] **Step 1: Add the failing UI contract test**

Append to `tests/payroll-export.test.ts`:

```ts
describe("payroll export confirmation interface", () => {
  it("keeps export available and confirms incomplete attendance inline", () => {
    const screen = source("src/components/payroll/production-payroll-screen.tsx");

    expect(screen).not.toContain(
      "disabled={reviewReadiness.unresolved > 0 || reviewReadiness.pendingRequests > 0}",
    );
    expect(screen).toContain('confirmUnreviewed: confirmed ? "1" : "0"');
    expect(screen).toContain("Export unreviewed Excel");
    expect(screen).toContain("These hours may be inaccurate");
    expect(screen).toContain('role="alert"');
  });
});
```

- [ ] **Step 2: Run the UI test and verify the expected failure**

Run:

```powershell
npm.cmd test -- tests/payroll-export.test.ts
```

Expected: FAIL because the export button is disabled and no confirmation panel exists.

- [ ] **Step 3: Add confirmation state and request construction**

In `src/components/payroll/production-payroll-screen.tsx`, add state and a readiness flag after the existing date state:

```ts
const [confirmExportOpen, setConfirmExportOpen] = useState(false);
const attendanceIncomplete =
  reviewReadiness.unresolved > 0 || reviewReadiness.pendingRequests > 0;
```

Replace `download()` with:

```ts
function download(confirmed = false) {
  const query = new URLSearchParams({
    from: periodStart,
    to: periodEnd,
    inactive: includeInactive ? "1" : "0",
    managers: includeManagers ? "1" : "0",
    zero: includeZero ? "1" : "0",
    confirmUnreviewed: confirmed ? "1" : "0",
  });
  window.location.assign(`/payroll/export?${query.toString()}`);
}

function requestDownload() {
  if (attendanceIncomplete) {
    setConfirmExportOpen(true);
    return;
  }
  download();
}
```

- [ ] **Step 4: Replace the disabled export control**

Replace the button row with:

```tsx
<div className="mt-4 flex flex-wrap gap-3">
  <Button onClick={apply}>Preview period</Button>
  <Button variant="secondary" onClick={requestDownload}>
    <FileSpreadsheet className="h-4 w-4" /> Export Excel
  </Button>
</div>
```

- [ ] **Step 5: Add the inline confirmation panel**

Place this immediately after the button row:

```tsx
{confirmExportOpen && attendanceIncomplete ? (
  <div
    className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4"
    role="alert"
  >
    <p className="font-black text-amber-950">Export unreviewed attendance?</p>
    <p className="mt-2 text-sm text-amber-900">
      These hours may be inaccurate. {reviewReadiness.unresolved} worked day(s)
      are not reviewed and {reviewReadiness.pendingRequests} staff correction
      request(s) remain open. Check and correct the workbook manually before
      using it for payroll.
    </p>
    <div className="mt-4 flex flex-wrap gap-3">
      <Button onClick={() => download(true)}>
        <FileSpreadsheet className="h-4 w-4" /> Export unreviewed Excel
      </Button>
      <Button variant="secondary" onClick={() => setConfirmExportOpen(false)}>
        Cancel
      </Button>
    </div>
  </div>
) : null}
```

Do not alter the existing amber readiness summary or the payroll-preparation disclaimer.

- [ ] **Step 6: Run the focused tests**

Run:

```powershell
npm.cmd test -- tests/payroll-export.test.ts tests/payroll-review.test.ts
```

Expected: PASS for both test files.

- [ ] **Step 7: Commit the confirmation interface**

```powershell
git add -- "tests/payroll-export.test.ts" "src/components/payroll/production-payroll-screen.tsx"
git commit -m "Confirm unreviewed payroll downloads"
```

---

### Task 4: Verify the Complete Manager Workflow

**Files:**
- Verify only; do not add committed screenshots or temporary browser scripts.

**Interfaces:**
- Consumes: `/payroll` and `/payroll/export`
- Produces: verified manager workflow and a clean validation report

- [ ] **Step 1: Run all automated checks**

Run:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected:

- ESLint exits 0.
- TypeScript exits 0.
- All Vitest files pass.
- Next.js production build exits 0 and includes `/payroll` plus `/payroll/export`.

- [ ] **Step 2: Check the final diff without disturbing unrelated changes**

Run:

```powershell
git diff --check
git status --short
git log -4 --oneline
```

Expected: no whitespace errors. Existing unrelated attendance migration and test changes may remain unstaged.

- [ ] **Step 3: Start the local application**

Run:

```powershell
npm.cmd run dev
```

Expected: Next.js reports the local URL and accepts requests.

- [ ] **Step 4: Verify the rendered manager interaction**

Using the Browser plugin:

1. Open the local `/payroll` route with a manager session.
2. Select a period with incomplete attendance.
3. Confirm the **Export Excel** button is enabled.
4. Select **Export Excel**.
5. Confirm the inline warning displays the readiness counts.
6. Select **Cancel** and confirm no download starts.
7. Open the panel again and select **Export unreviewed Excel**.
8. Confirm an `.xlsx` download starts with `jan-unreviewed-payroll-preparation-` in the filename.
9. Confirm there are no relevant console errors or framework overlays.

- [ ] **Step 5: Inspect the downloaded workbook**

Open the workbook with ExcelJS in a temporary script outside the repository and verify:

```ts
expect(workbook.subject).toBe("UNREVIEWED PAYROLL PREPARATION");
expect(workbook.getWorksheet("Read Me")?.getCell("A1").value).toBe(
  "UNREVIEWED PAYROLL PREPARATION",
);
expect(workbook.getWorksheet("Payroll Preparation")).toBeTruthy();
```

Also verify that the existing attendance review and warning columns remain present.

- [ ] **Step 6: Verify the reviewed path**

Use a fully reviewed period or the workbook unit test to confirm:

- export remains one click;
- the normal filename does not contain `unreviewed`;
- the Read Me label remains `Jan Pre-School payroll preparation`.

- [ ] **Step 7: Record the verification outcome**

Report the exact automated check results, the rendered interaction path, the downloaded filename, and the workbook labels. If verification reveals a defect, stop and create a new red-green task with the concrete failing behaviour before changing production code.
