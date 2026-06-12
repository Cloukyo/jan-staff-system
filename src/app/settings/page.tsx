import { SettingsScreen } from "@/components/settings/settings-screen";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";

export default async function SettingsPage() {
  if (getAppMode() === "production") await requireAccount(["manager"]);
  return <SettingsScreen />;
}
