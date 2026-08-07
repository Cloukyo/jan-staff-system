import { requireAccount } from "@/lib/auth/permissions";
import {
  loadJanLegacyPayrollAttendanceData,
  loadJanLegacyPayrollAttendanceReviews,
  loadJanLegacyPayrollRotaShifts,
  loadJanLegacyPayrollStaffRows,
} from "@/lib/payroll/server";

export type JanLegacyPayrollManager = Awaited<ReturnType<typeof requireAccount>>;

export async function requireJanLegacyPayrollManager(): Promise<JanLegacyPayrollManager> {
  return requireAccount(["manager"]);
}

/**
 * Explicit compatibility path for Jan Pre-School's inherited, unowned payroll data.
 * Commercial membership failures other than membership_required must never call it.
 */
export async function loadJanLegacyPayrollWorkspace(
  periodStart: string,
  periodEnd: string,
) {
  const [staff, attendance, attendanceReviews, rotaShifts] = await Promise.all([
    loadJanLegacyPayrollStaffRows(),
    loadJanLegacyPayrollAttendanceData(periodStart, periodEnd),
    loadJanLegacyPayrollAttendanceReviews(periodStart, periodEnd),
    loadJanLegacyPayrollRotaShifts(periodStart, periodEnd),
  ]);
  return { staff, attendance, attendanceReviews, rotaShifts };
}
