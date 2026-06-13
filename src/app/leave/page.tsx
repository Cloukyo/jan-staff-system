import { MyLeaveScreen } from "@/components/leave/leave-screens";
import { ProductionMyLeave } from "@/components/leave/production-leave";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { listLeaveRequestsForAccount } from "@/lib/leave/server";

export const dynamic = "force-dynamic";

export default async function LeavePage() {
  if (getAppMode() === "demo") return <MyLeaveScreen />;
  const account = await requireAccount(["manager", "staff"]);
  const requests = await listLeaveRequestsForAccount(account);
  return <AppShell role={account.role}><ProductionMyLeave requests={requests} /></AppShell>;
}
