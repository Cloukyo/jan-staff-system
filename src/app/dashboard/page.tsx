import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { ProductionDashboard, ProductionDashboardError } from "@/components/dashboard/production-dashboard";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { loadProductionDashboard } from "@/lib/dashboard/server";
import { isoDateInLondon } from "@/lib/dates/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (getAppMode() === "demo") return <DashboardScreen />;
  await requireAccount(["manager"]);
  let data = null;
  try {
    data = await loadProductionDashboard(isoDateInLondon());
  } catch {
    data = null;
  }
  return <AppShell>{data ? <ProductionDashboard data={data} /> : <ProductionDashboardError />}</AppShell>;
}
