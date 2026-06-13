import { AttendanceScreen } from "@/components/attendance/attendance-screen";
import { AttendanceReview } from "@/components/attendance/attendance-review";
import { ProductionAttendance } from "@/components/attendance/production-attendance";
import { AppShell } from "@/components/layout/app-shell";
import Link from "next/link";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { loadManagerAttendance } from "@/lib/kiosk/server";
import { loadAttendanceReviewDay } from "@/lib/attendance/review-server";

export const dynamic = "force-dynamic";

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  if (getAppMode() === "demo") return <AttendanceScreen />;
  await requireAccount(["manager"]);
  const { date } = await searchParams;
  const [dataset, review] = await Promise.all([loadManagerAttendance(), loadAttendanceReviewDay(date)]);
  return <AppShell><div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold text-green-700">Production data | Supabase</p><h1 className="mt-1 text-3xl font-black text-purple-950">Attendance</h1><p className="mt-2 text-slate-600">Review each day, resolve exceptions and preserve original clock events.</p></div><Link className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200" href="/settings/kiosk">Open Kiosk Setup</Link></div><div className="grid gap-5"><AttendanceReview data={review} /><ProductionAttendance {...dataset} /></div></AppShell>;
}
