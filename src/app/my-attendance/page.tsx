import { AppShell } from "@/components/layout/app-shell";
import { MyAttendance } from "@/components/staff-self-service/my-attendance";
import { loadStaffAttendance } from "@/lib/staff-self-service/server";

export const dynamic = "force-dynamic";

export default async function MyAttendancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { from, to } = await searchParams;
  const data = await loadStaffAttendance(from, to);
  return <AppShell role="staff"><MyAttendance data={data} /></AppShell>;
}
