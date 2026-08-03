import { StaffComplianceScreen } from "@/components/compliance/staff-compliance-screen";
import { redirect } from "next/navigation";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  if (getAppMode() === "demo") return <StaffComplianceScreen />;
  await requireAccount(["manager"]);
  redirect("/staff?filter=needs-checks");
}
