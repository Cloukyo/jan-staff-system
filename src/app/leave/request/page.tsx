import { RequestLeaveScreen } from "@/components/leave/leave-screens";
import { ProductionLeaveRequest } from "@/components/leave/production-leave";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireLeaveActor } from "@/lib/leave/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RequestLeavePage() {
  if (getAppMode() === "demo") return <RequestLeaveScreen />;
  const actor = await requireLeaveActor();
  if (actor.kind === "commercial" && !actor.context.staffId) redirect("/leave/requests");
  const account = actor.kind === "commercial" ? {
    id: actor.context.membershipId, authUserId: null, staffId: actor.context.staffId ?? "", fullName: "Staff member", email: "",
    role: (actor.context.staffId ? "staff" : "manager") as "staff" | "manager", active: true, mustChangePassword: false, createdAt: "", updatedAt: "",
  } : actor.account;
  return <AppShell role={account.role}><ProductionLeaveRequest account={account} /></AppShell>;
}
