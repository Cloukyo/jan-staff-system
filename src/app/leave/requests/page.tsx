import { ManagerLeaveRequestsScreen } from "@/components/leave/leave-screens";
import { ProductionManagerLeave } from "@/components/leave/production-leave";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { listCommercialLeaveRequests, listCommercialLeaveStaff, listLeaveRequestsForAccount, listStaffAccounts, requireLeaveActor } from "@/lib/leave/server";

export const dynamic = "force-dynamic";

export default async function LeaveRequestsPage() {
  if (getAppMode() === "demo") return <ManagerLeaveRequestsScreen />;
  const actor = await requireLeaveActor();
  const [requests, accounts] = actor.kind === "commercial"
    ? await Promise.all([listCommercialLeaveRequests(actor.context), listCommercialLeaveStaff(actor.context)])
    : await Promise.all([listLeaveRequestsForAccount(actor.account), listStaffAccounts()]);
  return <AppShell><ProductionManagerLeave requests={requests} accounts={accounts} /></AppShell>;
}
