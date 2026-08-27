import { RotaScreen } from "@/components/rota/rota-screen";
import { ProductionRota } from "@/components/rota/production-rota";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { isoDateInLondon, isoDate, weekStart } from "@/lib/dates/format";
import { loadProductionRota } from "@/lib/rota/server";
import { loadRotaTemplateSummaries, loadTemplateApplicationPreview } from "@/lib/rota/template-server";
import type { RotaTemplateApplyMode } from "@/lib/rota/template-types";
import { loadCommercialProductionRota, loadCommercialRotaTemplates } from "@/lib/rota/commercial-server";
import { loadCommercialRotaSiteChoices } from "@/lib/rota/commercial-server";
import { resolveCustomerDomainActor } from "@/lib/customer-domain/actor";
import { requireActiveMembership } from "@/lib/commercial-identity/server";
import { requireAccount } from "@/lib/auth/permissions";
import { requireSitePermission } from "@/lib/commercial-identity/guards";
import { selectCommercialSite } from "@/lib/commercial-identity/actions";
import { Field, Panel, inputClassName } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function RotaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (getAppMode() === "demo") return <RotaScreen />;
  const actor = await resolveCustomerDomainActor({
    loadCommercial: () => requireActiveMembership({ selectionMode: "sensitive" }),
    loadLegacyManager: () => requireAccount(["manager"]),
  });
  const params = await searchParams;
  const requested = typeof params.week === "string" ? params.week : isoDateInLondon();
  const start = isoDate(weekStart(requested));
  const templateId = typeof params.template === "string" ? params.template : undefined;
  const requestedMode = typeof params.templateMode === "string" ? params.templateMode : "empty_days";
  const templateMode: RotaTemplateApplyMode = ["empty_days", "replace", "alongside"].includes(requestedMode)
    ? requestedMode as RotaTemplateApplyMode
    : "empty_days";
  if (actor.kind === "commercial" && !actor.context.selectedSiteId) {
    const sites = await loadCommercialRotaSiteChoices(actor.context);
    return <AppShell><Panel className="mx-auto max-w-xl">
      <h1 className="text-3xl font-black text-purple-950">Choose a rota site</h1>
      <p className="mt-2 text-slate-600">Select the site whose schedule you want to view or edit.</p>
      <form action={selectCommercialSite} className="mt-5 grid gap-4">
        <input type="hidden" name="membershipId" value={actor.context.membershipId} />
        <input type="hidden" name="continuation" value={`/rota?week=${start}`} />
        <Field label="Site"><select className={inputClassName()} name="siteId" required>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
        <button className="min-h-11 rounded-xl bg-purple-700 px-5 font-bold text-white" type="submit">Open rota</button>
      </form>
    </Panel></AppShell>;
  }
  if (actor.kind === "commercial") requireSitePermission(actor.context, "rota.read");
  const data = actor.kind === "commercial"
    ? await loadCommercialProductionRota(actor.context, start)
    : await loadProductionRota(start);
  const commercialTemplates = actor.kind === "commercial"
    ? await loadCommercialRotaTemplates(actor.context, start, data, templateId, templateMode)
    : null;
  const templates = commercialTemplates?.templates ?? await loadRotaTemplateSummaries();
  const templatePreview = commercialTemplates?.preview ?? (templateId && actor.kind === "legacy"
    ? await loadTemplateApplicationPreview(templateId, templateMode, data)
    : null);
  return <AppShell><ProductionRota
    data={data}
    templates={templates}
    templatePreview={templatePreview}
    selectedTemplateId={templateId}
    selectedTemplateMode={templateMode}
    templateRequestKey={crypto.randomUUID()}
  /></AppShell>;
}
