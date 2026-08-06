import { SettingsScreen } from "@/components/settings/settings-screen";
import { ProductionSettingsScreen } from "@/components/settings/production-settings";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireCustomerDomainActor } from "@/lib/customer-domain/server-actor";
import { loadCommercialSiteSettings, loadProductionSiteSettings } from "@/lib/settings/server";

export default async function SettingsPage() {
  if (getAppMode() === "demo") return <SettingsScreen />;
  const actor = await requireCustomerDomainActor("settings.manage", { siteRequired: true });
  const settings = actor.kind === "commercial"
    ? await loadCommercialSiteSettings(actor.context)
    : await loadProductionSiteSettings();
  return <AppShell><ProductionSettingsScreen settings={settings} /></AppShell>;
}
