import { KioskScreen } from "@/components/kiosk/kiosk-screen";
import { ProductionKiosk } from "@/components/kiosk/production-kiosk";
import { getAppMode } from "@/lib/app-mode";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { KioskDeviceAccessError, loadProductionKioskRoster } from "@/lib/kiosk/server";
import { getKioskDeviceToken } from "@/lib/kiosk/device-session";
import { exitKioskModeAction } from "@/lib/kiosk/device-actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ClockPage() {
  if (getAppMode() === "demo") return <KioskScreen />;
  if (!hasSupabaseConfig()) {
    return <main className="min-h-screen bg-purple-950 p-8 text-center text-white"><h1 className="text-3xl font-black">Staff Clock unavailable</h1><p className="mt-4">Production Supabase configuration is missing. Please ask a manager for help.</p></main>;
  }
  const hasSavedDevice = Boolean(await getKioskDeviceToken());
  let roster;
  try {
    roster = await loadProductionKioskRoster();
  } catch (error) {
    const accessError = error instanceof KioskDeviceAccessError ? error : null;
    console.error("[staff-clock] roster load failed", {
      code: accessError?.code ?? "unknown",
      hasSavedDevice,
    });
    if (hasSavedDevice) {
      return (
        <main className="grid min-h-screen place-items-center bg-purple-950 p-6 text-white">
          <div className="max-w-lg text-center">
            <h1 className="text-3xl font-black">Staff Clock could not load</h1>
            <p className="mt-4">
              {accessError?.code === "device_rejected"
                ? "This browser has a saved registration, but it is no longer active."
                : "This browser is registered, but the staff list could not be loaded. This may be temporary."}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link className="inline-flex min-h-11 items-center rounded-lg bg-white px-5 font-bold text-purple-950" href="/clock">Try again</Link>
              <form action={exitKioskModeAction}>
                <button className="min-h-11 rounded-lg border border-white px-5 font-bold text-white" type="submit">Remove saved registration</button>
              </form>
            </div>
          </div>
        </main>
      );
    }
    return <main className="grid min-h-screen place-items-center bg-purple-950 p-6 text-white"><div className="max-w-lg text-center"><h1 className="text-3xl font-black">Staff Clock setup required</h1><p className="mt-4">This browser has not been registered. A manager can sign in once, open Kiosk Setup, and activate this device.</p><Link className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-white px-5 font-bold text-purple-950" href="/login">Set up this device</Link></div></main>;
  }
  return <ProductionKiosk initialRoster={roster} />;
}
