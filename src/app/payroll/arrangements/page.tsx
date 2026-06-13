import { AppShell } from "@/components/layout/app-shell";
import { ProductionStaffScreen } from "@/components/staff/production-staff-screen";
import { requireAccount } from "@/lib/auth/permissions";
import { loadProductionStaffRows } from "@/lib/payroll/server";

export const dynamic = "force-dynamic";

export default async function PayArrangementsPage() {
  await requireAccount(["manager"]);
  const staff = await loadProductionStaffRows();
  return (
    <AppShell>
      <div className="mb-6">
        <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">Pay arrangements</h1>
        <p className="mt-2 text-slate-600">Manage effective-dated hourly and salaried arrangements for canonical staff profiles.</p>
      </div>
      <ProductionStaffScreen staff={staff} />
    </AppShell>
  );
}
