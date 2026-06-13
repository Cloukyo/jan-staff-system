import { KioskScreen } from "@/components/kiosk/kiosk-screen";
import { ProductionKiosk } from "@/components/kiosk/production-kiosk";
import { getAppMode } from "@/lib/app-mode";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { loadProductionKioskRoster } from "@/lib/kiosk/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ClockPage() {
  if (getAppMode() === "demo") return <KioskScreen />;
  if (!hasSupabaseConfig()) {
    return <main className="min-h-screen bg-purple-950 p-8 text-center text-white"><h1 className="text-3xl font-black">Staff Clock unavailable</h1><p className="mt-4">Production Supabase configuration is missing. Please ask a manager for help.</p></main>;
  }
  const roster = await loadProductionKioskRoster().catch(() => null);
  if (!roster) {
    return <main className="grid min-h-screen place-items-center bg-purple-950 p-6 text-white"><div className="max-w-lg text-center"><h1 className="text-3xl font-black">Staff Clock setup required</h1><p className="mt-4">This browser has not been registered. A manager can sign in once, open Kiosk Setup, and activate this device.</p><Link className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-white px-5 font-bold text-purple-950" href="/login">Set up this device</Link></div></main>;
  }
  return <ProductionKiosk initialRoster={roster} />;
}
