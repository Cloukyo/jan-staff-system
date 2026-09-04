import { AppShell } from "@/components/layout/app-shell";
import { HolidayPayEvidence } from "@/components/leave/holiday-pay-evidence";
import { loadHolidayPayEvidencePage } from "@/lib/retention/server";

export const dynamic = "force-dynamic";

export default async function LeaveRecordsPage() {
  return <AppShell><HolidayPayEvidence data={await loadHolidayPayEvidencePage()} /></AppShell>;
}
