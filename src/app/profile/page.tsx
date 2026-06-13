import { ProfileScreen } from "@/components/leave/leave-screens";
import { ProductionProfileScreen } from "@/components/profile/production-profile";
import { AppShell } from "@/components/layout/app-shell";
import { getAppMode } from "@/lib/app-mode";
import { loadCurrentProductionProfile } from "@/lib/profile/server";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  if (getAppMode() === "demo") return <ProfileScreen />;
  const data = await loadCurrentProductionProfile();
  return <AppShell><ProductionProfileScreen data={data} /></AppShell>;
}
