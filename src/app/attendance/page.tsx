import { AttendanceScreen } from "@/components/attendance/attendance-screen";
import { ProductionAttendance } from "@/components/attendance/production-attendance";
import { AppShell } from "@/components/layout/app-shell";
import Link from "next/link";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { loadManagerAttendance } from "@/lib/kiosk/server";

export const dynamic = "force-dynamic";

export default async function AttendancePage() {
  if (getAppMode() === "demo") return <AttendanceScreen />;
  await requireAccount(["manager"]);
  const dataset = await loadManagerAttendance();
  return <AppShell><div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold text-green-700">Production data | Supabase</p><h1 className="mt-1 text-3xl font-black text-purple-950">Attendance</h1><p className="mt-2 text-slate-600">View live clock status, recent history and add auditable corrections.</p></div><Link className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200" href="/settings/kiosk">Open Kiosk Setup</Link></div><ProductionAttendance {...dataset} /></AppShell>;
}
