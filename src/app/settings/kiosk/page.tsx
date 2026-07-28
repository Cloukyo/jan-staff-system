import Link from "next/link";
import { Clock3 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { KioskDeviceManagement } from "@/components/kiosk/device-management";
import { requireAccount } from "@/lib/auth/permissions";
import { loadKioskDevices } from "@/lib/kiosk/server";

export const dynamic = "force-dynamic";

export default async function KioskSettingsPage() {
  await requireAccount(["manager"]);
  const devices = await loadKioskDevices();
  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-purple-950">Clocking-in devices</h1>
          <p className="mt-2 text-slate-600">Register nursery tablets that staff use to clock in and out.</p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700"
          href="/clock"
        >
          <Clock3 aria-hidden className="h-5 w-5" />
          Open Staff Clock
        </Link>
      </div>
      <KioskDeviceManagement devices={devices} />
    </AppShell>
  );
}
