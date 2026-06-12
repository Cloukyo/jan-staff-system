import { AppShell } from "@/components/layout/app-shell";
import { KioskDeviceManagement } from "@/components/kiosk/device-management";
import { requireAccount } from "@/lib/auth/permissions";
import { loadKioskDevices } from "@/lib/kiosk/server";

export const dynamic = "force-dynamic";

export default async function KioskSettingsPage() {
  await requireAccount(["manager"]);
  const devices = await loadKioskDevices();
  return <AppShell><div className="mb-6"><h1 className="text-3xl font-black text-purple-950">Kiosk devices</h1><p className="mt-2 text-slate-600">Activate, monitor and revoke restricted nursery clock devices.</p></div><KioskDeviceManagement devices={devices} /></AppShell>;
}
