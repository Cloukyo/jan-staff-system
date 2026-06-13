import { ManagerLeaveRequestsScreen } from "@/components/leave/leave-screens";
import { ProductionManagerLeave } from "@/components/leave/production-leave";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { listLeaveRequestsForAccount, listStaffAccounts } from "@/lib/leave/server";

export const dynamic = "force-dynamic";

export default async function LeaveRequestsPage() {
  if (getAppMode() === "demo") return <ManagerLeaveRequestsScreen />;
  const account = await requireAccount(["manager"]);
  const [requests, accounts] = await Promise.all([listLeaveRequestsForAccount(account), listStaffAccounts()]);
  return <AppShell><ProductionManagerLeave requests={requests} accounts={accounts} /></AppShell>;
}
