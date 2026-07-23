import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/auth/permissions";
import { loadAttendanceReviewReadiness } from "@/lib/attendance/review-server";
import { createPayrollPreparationRow } from "@/lib/payroll/calculations";
import { createPayrollExportDetail } from "@/lib/exports/payroll-detail";
import { createPayrollPreparationWorkbook } from "@/lib/exports/payroll-excel";
import {
  loadPayrollAttendanceReviews,
  loadPayrollRotaShifts,
  loadProductionClockEvents,
  loadProductionStaffRows,
} from "@/lib/payroll/server";

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
  const confirmUnreviewed = params.get("confirmUnreviewed") === "1";
  const [staff, events, reviews, readiness, shifts] = await Promise.all([
    loadProductionStaffRows(),
    loadProductionClockEvents(periodStart, periodEnd),
    loadPayrollAttendanceReviews(periodStart, periodEnd),
    loadAttendanceReviewReadiness(periodStart, periodEnd),
    loadPayrollRotaShifts(periodStart, periodEnd),
  ]);
  if ((readiness.unresolved > 0 || readiness.pendingRequests > 0) && !confirmUnreviewed) {
    return NextResponse.json(
      { error: "Confirm the unreviewed payroll export before downloading." },
      { status: 409 },
    );
  }
  const includedStaff = staff
    .filter((person) => (includeInactive || person.active) && (includeManagers || !person.isManager));
  const rows = includedStaff
    .map((person) => createPayrollPreparationRow(person, events, periodStart, periodEnd, reviews))
    .filter((row) => includeZero || row.adjustedMinutes > 0);
  const includedIds = new Set(rows.map((row) => row.staffId));
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
  const unreviewedPrefix =
    readiness.unresolved > 0 || readiness.pendingRequests > 0 ? "unreviewed-" : "";
  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="jan-${unreviewedPrefix}payroll-preparation-${periodStart}-to-${periodEnd}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
