import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  loadProductionStaffRows: vi.fn(),
  loadProductionAttendanceData: vi.fn(),
  loadPayrollAttendanceReviews: vi.fn(),
  loadAttendanceReviewReadiness: vi.fn(),
  loadPayrollRotaShifts: vi.fn(),
  createPayrollPreparationWorkbook: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({
  requireAccount: mocks.requireAccount,
}));

vi.mock("@/lib/payroll/server", () => ({
  loadProductionStaffRows: mocks.loadProductionStaffRows,
  loadProductionAttendanceData: mocks.loadProductionAttendanceData,
  loadPayrollAttendanceReviews: mocks.loadPayrollAttendanceReviews,
  loadPayrollRotaShifts: mocks.loadPayrollRotaShifts,
}));

vi.mock("@/lib/attendance/review-server", () => ({
  loadAttendanceReviewReadiness: mocks.loadAttendanceReviewReadiness,
}));

vi.mock("@/lib/exports/payroll-excel", () => ({
  createPayrollPreparationWorkbook: mocks.createPayrollPreparationWorkbook,
}));

import { GET } from "@/app/payroll/export/route";

describe("payroll export period validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadProductionStaffRows.mockResolvedValue([]);
    mocks.loadProductionAttendanceData.mockResolvedValue({
      effectiveEvents: [],
      audit: { originalEvents: [], correctionRecords: [] },
    });
    mocks.loadPayrollAttendanceReviews.mockResolvedValue([]);
    mocks.loadAttendanceReviewReadiness.mockResolvedValue({
      unresolved: 0,
      pendingRequests: 0,
    });
    mocks.loadPayrollRotaShifts.mockResolvedValue([]);
    mocks.createPayrollPreparationWorkbook.mockResolvedValue(Buffer.from("workbook"));
  });

  it.each([
    ["a 367-day period", "2026-01-01", "2027-01-02"],
    ["an impossible calendar date", "2026-02-30", "2026-03-01"],
  ])("returns a clear 400 response for %s", async (_label, from, to) => {
    const response = await GET(new Request(
      `https://example.test/payroll/export?from=${from}&to=${to}`,
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose a valid payroll period of up to 366 days.",
    });
    expect(mocks.loadProductionAttendanceData).not.toHaveBeenCalled();
  });
});
