import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { ProductionDashboard, ProductionDashboardError } from "@/components/dashboard/production-dashboard";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireAttendanceActor } from "@/lib/attendance/server-actor";
import { loadProductionDashboard } from "@/lib/dashboard/server";
import { isoDateInLondon } from "@/lib/dates/format";
import Link from "next/link";
import { loadAuthorisedSiteOptions } from "@/lib/commercial-identity/site-options";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (getAppMode() === "demo") return <DashboardScreen />;
  const actor = await requireAttendanceActor("attendance.read", { siteRequired: true });
  const site = actor.kind === "commercial"
    ? (await loadAuthorisedSiteOptions(actor.context)).find((option) => option.id === actor.context.selectedSiteId)
    : null;
  let data = null;
  try {
    data = await loadProductionDashboard(isoDateInLondon());
  } catch {
    data = null;
  }
  return <AppShell>{actor.kind === "commercial" ? <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-purple-950"><p><strong>{actor.context.organisationDisplayName}</strong> / {site?.name ?? "Selected site"}</p><Link className="inline-flex min-h-11 items-center font-semibold underline" href="/organisations/sites?next=%2Fdashboard">Change site</Link></div> : null}{data ? <ProductionDashboard data={data} /> : <ProductionDashboardError />}</AppShell>;
}
