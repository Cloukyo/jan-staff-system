import Link from "next/link";
import { Clock3 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { KioskDeviceManagement } from "@/components/kiosk/device-management";
import { StaffKioskManagement } from "@/components/kiosk/staff-kiosk-management";
import { requireAccount } from "@/lib/auth/permissions";
import { loadKioskDevices, loadManagerAttendance } from "@/lib/kiosk/server";

export const dynamic = "force-dynamic";

export default async function KioskSettingsPage() {
  await requireAccount(["manager"]);
  const [devices, attendance] = await Promise.all([loadKioskDevices(), loadManagerAttendance()]);
  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
          <h1 className="mt-1 text-3xl font-black text-purple-950">Kiosk Setup</h1>
          <p className="mt-2 text-slate-600">Register nursery tablets and manage which employees can use Staff Clock.</p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700"
          href="/clock"
        >
          <Clock3 aria-hidden className="h-5 w-5" />
          Open Staff Clock
        </Link>
      </div>
      <div className="grid gap-5">
        <KioskDeviceManagement devices={devices} />
        <StaffKioskManagement staff={attendance.staff} />
      </div>
    </AppShell>
  );
}
