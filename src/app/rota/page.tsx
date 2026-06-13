import { RotaScreen } from "@/components/rota/rota-screen";
import { ProductionRota } from "@/components/rota/production-rota";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { isoDateInLondon, isoDate, weekStart } from "@/lib/dates/format";
import { loadProductionRota } from "@/lib/rota/server";
import { loadRotaTemplateSummaries, loadTemplateApplicationPreview } from "@/lib/rota/template-server";
import type { RotaTemplateApplyMode } from "@/lib/rota/template-types";

export const dynamic = "force-dynamic";

export default async function RotaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (getAppMode() === "demo") return <RotaScreen />;
  await requireAccount(["manager"]);
  const params = await searchParams;
  const requested = typeof params.week === "string" ? params.week : isoDateInLondon();
  const start = isoDate(weekStart(requested));
  const dataPromise = loadProductionRota(start);
  const templatesPromise = loadRotaTemplateSummaries();
  const [data, templates] = await Promise.all([dataPromise, templatesPromise]);
  const templateId = typeof params.template === "string" ? params.template : undefined;
  const requestedMode = typeof params.templateMode === "string" ? params.templateMode : "empty_days";
  const templateMode: RotaTemplateApplyMode = ["empty_days", "replace", "alongside"].includes(requestedMode)
    ? requestedMode as RotaTemplateApplyMode
    : "empty_days";
  const templatePreview = templateId ? await loadTemplateApplicationPreview(templateId, templateMode, data) : null;
  return <AppShell><ProductionRota
    data={data}
    templates={templates}
    templatePreview={templatePreview}
    selectedTemplateId={templateId}
    selectedTemplateMode={templateMode}
    templateRequestKey={crypto.randomUUID()}
  /></AppShell>;
}
