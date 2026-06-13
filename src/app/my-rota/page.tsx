import { AppShell } from "@/components/layout/app-shell";
import { MyRota } from "@/components/staff-self-service/my-rota";
import { loadStaffRotaWeek } from "@/lib/staff-self-service/server";

export const dynamic = "force-dynamic";

export default async function MyRotaPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const data = await loadStaffRotaWeek(week);
  return <AppShell role="staff"><MyRota data={data} /></AppShell>;
}
