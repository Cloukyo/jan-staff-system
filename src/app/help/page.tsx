import { ManagerHelpScreen } from "@/components/help/manager-help-screen";
import { AppShell } from "@/components/layout/app-shell";
import { requireAccount } from "@/lib/auth/permissions";
import { managerHelpTasks } from "@/lib/help/manager-help";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  await requireAccount(["manager"]);

  return (
    <AppShell>
      <ManagerHelpScreen tasks={managerHelpTasks} />
    </AppShell>
  );
}
