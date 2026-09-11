import { AppShell } from "@/components/layout/app-shell";
import { ProductionProfileScreen } from "@/components/profile/production-profile";
import { loadCurrentProductionProfile } from "@/lib/profile/server";

export const dynamic = "force-dynamic";

export default async function QualificationsPage() {
  const data = await loadCurrentProductionProfile();
  return <AppShell role={data.account.role}><ProductionProfileScreen data={data} view="qualifications" /></AppShell>;
}
