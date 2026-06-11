import { KioskScreen } from "@/components/kiosk/kiosk-screen";
import { ProductionKiosk } from "@/components/kiosk/production-kiosk";
import { getAppMode } from "@/lib/app-mode";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { loadProductionKioskRoster } from "@/lib/kiosk/server";

export const dynamic = "force-dynamic";

export default async function ClockPage() {
  if (getAppMode() === "demo") return <KioskScreen />;
  if (!hasSupabaseConfig()) {
    return <main className="min-h-screen bg-purple-950 p-8 text-center text-white"><h1 className="text-3xl font-black">Kiosk unavailable</h1><p className="mt-4">Production Supabase configuration is missing. Please ask a manager for help.</p></main>;
  }
  const roster = await loadProductionKioskRoster();
  return <ProductionKiosk initialRoster={roster} />;
}
