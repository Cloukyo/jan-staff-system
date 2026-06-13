import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/auth/permissions";
import { loadAttendanceReviewReadiness } from "@/lib/attendance/review-server";
import { createPayrollPreparationRow } from "@/lib/payroll/calculations";
import { createPayrollPreparationWorkbook } from "@/lib/exports/payroll-excel";
import { loadPayrollAttendanceReviews, loadProductionClockEvents, loadProductionStaffRows } from "@/lib/payroll/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireAccount(["manager"]);
  const params = new URL(request.url).searchParams;
  const periodStart = params.get("from") ?? "";
  const periodEnd = params.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodStart > periodEnd) {
    return NextResponse.json({ error: "Choose a valid payroll period." }, { status: 400 });
  }
  const includeInactive = params.get("inactive") === "1";
  const includeManagers = params.get("managers") === "1";
  const includeZero = params.get("zero") !== "0";
  const [staff, events, reviews, readiness] = await Promise.all([
    loadProductionStaffRows(),
    loadProductionClockEvents(periodStart, periodEnd),
    loadPayrollAttendanceReviews(periodStart, periodEnd),
    loadAttendanceReviewReadiness(periodStart, periodEnd),
  ]);
  if (readiness.unresolved > 0 || readiness.pendingRequests > 0) {
    return NextResponse.json({ error: "Attendance review must be completed before export." }, { status: 409 });
  }
  const rows = staff
    .filter((person) => (includeInactive || person.active) && (includeManagers || !person.isManager))
    .map((person) => createPayrollPreparationRow(person, events, periodStart, periodEnd, reviews))
    .filter((row) => includeZero || row.adjustedMinutes > 0);
  const workbook = await createPayrollPreparationWorkbook(rows, periodStart, periodEnd);
  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="jan-payroll-preparation-${periodStart}-to-${periodEnd}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
