import { MyLeaveScreen } from "@/components/leave/leave-screens";
import { ProductionMyLeave } from "@/components/leave/production-leave";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { listCommercialLeaveRequests, listLeaveRequestsForAccount, requireLeaveActor } from "@/lib/leave/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LeavePage() {
  if (getAppMode() === "demo") return <MyLeaveScreen />;
  const actor = await requireLeaveActor();
  if (actor.kind === "commercial" && !actor.context.staffId) redirect("/leave/requests");
  const requests = actor.kind === "commercial" ? await listCommercialLeaveRequests(actor.context) : await listLeaveRequestsForAccount(actor.account);
  const role = actor.kind === "commercial" && actor.context.staffId ? "staff" : actor.kind === "legacy" ? actor.account.role : "manager";
  return <AppShell role={role}><ProductionMyLeave requests={requests} role={role} /></AppShell>;
}
