import { StaffComplianceScreen } from "@/components/compliance/staff-compliance-screen";
import { redirect } from "next/navigation";
import { getAppMode } from "@/lib/app-mode";
import { requireCustomerDomainActor } from "@/lib/customer-domain/server-actor";

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  if (getAppMode() === "demo") return <StaffComplianceScreen />;
  await requireCustomerDomainActor("compliance.read", { siteRequired: true });
  redirect("/staff?filter=needs-checks");
}
