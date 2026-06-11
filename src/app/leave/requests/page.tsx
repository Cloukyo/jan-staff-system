import { ManagerLeaveRequestsScreen } from "@/components/leave/leave-screens";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { requireAccount } from "@/lib/auth/permissions";

export default async function LeaveRequestsPage() {
  if (hasSupabaseConfig()) await requireAccount(["manager"]);
  return <ManagerLeaveRequestsScreen />;
}
