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
    expect(route).toContain("parsePayrollExportHoursMode(params)");
    expect(route).toContain("payrollModeIncludesClocked(hoursMode)");
    expect(route).toMatch(
      /if \(\s*payrollModeIncludesClocked\(hoursMode\)[\s\S]*readiness\.unresolved > 0[\s\S]*!confirmUnreviewed\s*\)/,
    );
    expect(route).toContain("Confirm the unreviewed payroll export before downloading.");
    expect(route).toContain('requireAccount(["manager"])');
  });

  it("loads period rota shifts and passes export detail into the workbook", () => {
    const route = source("src/app/payroll/export/route.ts");
    const server = source("src/lib/payroll/server.ts");

    expect(server).toContain("export async function loadPayrollRotaShifts");
    expect(server).toContain('.gte("shift_date", periodStart)');
    expect(server).toContain('.lte("shift_date", periodEnd)');
    expect(server).toContain('.neq("status", "cancelled")');
    expect(server).toContain('.is("archived_at", null)');
    expect(route).toContain("loadPayrollRotaShifts(periodStart, periodEnd)");
    expect(route).toContain("createPayrollExportDetail");
    expect(route).toContain("payrollRowHasSelectedHours");
    expect(route).toContain("{ hours: hoursMode }");
    expect(route).toMatch(
      /createPayrollPreparationWorkbook\(\s*rows,\s*periodStart,\s*periodEnd,\s*readiness,\s*detail,\s*\{ hours: hoursMode \},\s*\)/,
    );
  });
});

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
    expect(screen).toContain('label="Hours to include"');
    expect(screen).toContain("Both planned and clocked");
    expect(screen).toContain("Planned hours only");
    expect(screen).toContain("Clocked hours only");
    expect(screen).toContain("hours: exportHours");
    expect(screen).toContain('exportHours !== "planned"');
  });
});
