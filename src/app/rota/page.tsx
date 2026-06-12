import { RotaScreen } from "@/components/rota/rota-screen";
import { ProductionRota } from "@/components/rota/production-rota";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { isoDateInLondon, isoDate, weekStart } from "@/lib/dates/format";
import { loadProductionRota } from "@/lib/rota/server";

export const dynamic = "force-dynamic";

export default async function RotaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (getAppMode() === "demo") return <RotaScreen />;
  await requireAccount(["manager"]);
  const params = await searchParams;
  const requested = typeof params.week === "string" ? params.week : isoDateInLondon();
  const start = isoDate(weekStart(requested));
  const data = await loadProductionRota(start);
  return <AppShell><ProductionRota data={data} /></AppShell>;
}
