import { RequestLeaveScreen } from "@/components/leave/leave-screens";
import { ProductionLeaveRequest } from "@/components/leave/production-leave";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function RequestLeavePage() {
  if (getAppMode() === "demo") return <RequestLeaveScreen />;
  const account = await requireAccount(["manager", "staff"]);
  return <AppShell role={account.role}><ProductionLeaveRequest account={account} /></AppShell>;
}
