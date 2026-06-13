import { PayrollScreen } from "@/components/payroll/payroll-screen";
import { ProductionPayrollScreen } from "@/components/payroll/production-payroll-screen";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { isoDateInLondon } from "@/lib/dates/format";
import { createPayrollPreparationRow } from "@/lib/payroll/calculations";
import { loadProductionClockEvents, loadProductionStaffRows } from "@/lib/payroll/server";
import { loadAttendanceReviewReadiness } from "@/lib/attendance/review-server";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (getAppMode() === "demo") return <PayrollScreen />;
  await requireAccount(["manager"]);
  const params = await searchParams;
  const today = isoDateInLondon();
  const [year, month] = today.split("-").map(Number);
  const defaultStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const defaultEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const periodStart = typeof params.from === "string" ? params.from : defaultStart;
  const periodEnd = typeof params.to === "string" ? params.to : defaultEnd;
  const includeInactive = params.inactive === "1";
  const includeManagers = params.managers === "1";
  const includeZero = params.zero !== "0";
  const [staff, events, reviewReadiness] = await Promise.all([
    loadProductionStaffRows(),
    loadProductionClockEvents(periodStart, periodEnd),
    loadAttendanceReviewReadiness(periodStart, periodEnd),
  ]);
  const rows = staff
    .filter((person) => (includeInactive || person.active) && (includeManagers || !person.isManager))
    .map((person) => createPayrollPreparationRow(person, events, periodStart, periodEnd))
    .filter((row) => includeZero || row.recordedMinutes > 0);
  return <AppShell><div className="mb-6"><p className="text-sm font-bold text-green-700">Production data | Supabase</p><h1 className="mt-1 text-3xl font-black text-purple-950">Pay preparation</h1><p className="mt-2 text-slate-600">Attendance and effective pay arrangements for manager review. This is not completed payroll.</p></div><ProductionPayrollScreen rows={rows} periodStart={periodStart} periodEnd={periodEnd} includeInactive={includeInactive} includeManagers={includeManagers} includeZero={includeZero} reviewReadiness={reviewReadiness} /></AppShell>;
}
