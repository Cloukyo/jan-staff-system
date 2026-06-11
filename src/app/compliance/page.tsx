import { StaffComplianceScreen } from "@/components/compliance/staff-compliance-screen";
import { ProductionComplianceScreen } from "@/components/compliance/production-compliance-screen";
import { Panel } from "@/components/ui/primitives";
import { getAppMode } from "@/lib/app-mode";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { requireAccount } from "@/lib/auth/permissions";
import { loadProductionComplianceDataset } from "@/lib/compliance/repository";

export default async function CompliancePage() {
  if (getAppMode() === "demo") return <StaffComplianceScreen />;
  if (!hasSupabaseConfig()) {
    return <main className="p-6"><Panel><h1 className="text-2xl font-black text-purple-950">Production compliance is not configured</h1><p className="mt-2 text-slate-600">Set the Supabase environment variables. Production mode will not fall back to demo records.</p></Panel></main>;
  }
  await requireAccount(["manager"]);
  let data;
  let loadError = "";
  try {
    data = await loadProductionComplianceDataset();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unknown Supabase error";
  }
  if (!data) return <main className="p-6"><Panel><h1 className="text-2xl font-black text-purple-950">Compliance data could not be loaded</h1><p className="mt-2 text-red-700">{loadError}</p></Panel></main>;
  return <ProductionComplianceScreen data={data} />;
}
