import { AccountsScreen } from "@/components/leave/leave-screens";
import { ProductionAccountsScreen } from "@/components/accounts/production-accounts";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { loadProductionAccounts } from "@/lib/accounts/server";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  if (getAppMode() === "demo") return <AccountsScreen />;
  const data = await loadProductionAccounts();
  return <AppShell><ProductionAccountsScreen {...data} /></AppShell>;
}
