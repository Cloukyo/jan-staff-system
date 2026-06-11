import { notFound } from "next/navigation";
import { StaffComplianceDetail } from "@/components/compliance/staff-compliance-detail";
import { ProductionComplianceDetail } from "@/components/compliance/production-compliance-detail";
import { Panel } from "@/components/ui/primitives";
import { getAppMode } from "@/lib/app-mode";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { requireAccount } from "@/lib/auth/permissions";
import { loadProductionStaffCompliance } from "@/lib/compliance/repository";

export default async function StaffComplianceDetailPage({ params }: { params: Promise<{ staffId: string }> }) {
  const { staffId } = await params;
  if (getAppMode() === "demo") return <StaffComplianceDetail staffId={staffId} />;
  if (!hasSupabaseConfig()) {
    return <main className="p-6"><Panel><h1 className="text-2xl font-black text-purple-950">Production compliance is not configured</h1><p className="mt-2 text-slate-600">Set the Supabase environment variables. Demo records are not used in production mode.</p></Panel></main>;
  }
  await requireAccount(["manager"]);
  const record = await loadProductionStaffCompliance(staffId);
  if (!record) notFound();
  return <ProductionComplianceDetail record={record} />;
}
