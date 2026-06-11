import { AttendanceScreen } from "@/components/attendance/attendance-screen";
import { ProductionAttendance } from "@/components/attendance/production-attendance";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { loadManagerAttendance } from "@/lib/kiosk/server";

export const dynamic = "force-dynamic";

export default async function AttendancePage() {
  if (getAppMode() === "demo") return <AttendanceScreen />;
  await requireAccount(["manager"]);
  const dataset = await loadManagerAttendance();
  return <AppShell><div className="mb-6"><p className="text-sm font-bold text-green-700">Production data · Supabase</p><h1 className="mt-1 text-3xl font-black text-purple-950">Attendance and kiosk</h1><p className="mt-2 text-slate-600">Manage kiosk access, view live clock status and add auditable corrections.</p></div><ProductionAttendance {...dataset} /></AppShell>;
}
