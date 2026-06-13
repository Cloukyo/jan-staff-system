import { SettingsScreen } from "@/components/settings/settings-screen";
import { ProductionSettingsScreen } from "@/components/settings/production-settings";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";

export default async function SettingsPage() {
  if (getAppMode() === "demo") return <SettingsScreen />;
  await requireAccount(["manager"]);
  return <AppShell><ProductionSettingsScreen /></AppShell>;
}
