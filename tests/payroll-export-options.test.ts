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
