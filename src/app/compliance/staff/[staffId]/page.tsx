import { notFound } from "next/navigation";
import { StaffComplianceDetail } from "@/components/compliance/staff-compliance-detail";
import { ProductionComplianceDetail } from "@/components/compliance/production-compliance-detail";
import { Panel } from "@/components/ui/primitives";
import { loadProductionAccounts } from "@/lib/accounts/server";
import { getAppMode } from "@/lib/app-mode";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { loadProductionStaffCompliance } from "@/lib/compliance/repository";
import { requireCustomerDomainActor } from "@/lib/customer-domain/server-actor";
import { loadManagerAttendance } from "@/lib/kiosk/server";
import { loadProductionStaffRows } from "@/lib/payroll/server";
import { parseStaffRecordSection } from "@/lib/staff/record-sections";

export const dynamic = "force-dynamic";

export default async function StaffComplianceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ staffId: string }>;
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const { staffId } = await params;
  const section = parseStaffRecordSection((await searchParams).section);
  if (getAppMode() === "demo") return <StaffComplianceDetail staffId={staffId} />;
  if (!hasSupabaseConfig()) {
    return <main className="p-6"><Panel><h1 className="text-2xl font-black text-purple-950">Production compliance is not configured</h1><p className="mt-2 text-slate-600">Set the Supabase environment variables. Demo records are not used in production mode.</p></Panel></main>;
  }
  const actor = await requireCustomerDomainActor("compliance.read", { siteRequired: true });
  const commercialContext = actor.kind === "commercial" ? actor.context : undefined;
  const [record, attendance, accountData, staffRows] = await Promise.all([
    loadProductionStaffCompliance(staffId, commercialContext),
    actor.kind === "legacy" || actor.context.permissions.includes("attendance.read")
      ? loadManagerAttendance()
      : Promise.resolve({ staff: [], events: [] }),
    actor.kind === "legacy"
      ? loadProductionAccounts()
      : Promise.resolve({ accounts: [], adminConfigured: false }),
    loadProductionStaffRows(commercialContext),
  ]);
  if (!record) notFound();
  const kioskPerson = attendance.staff.find((person) => person.staffId === staffId) ?? null;
  const account = accountData.accounts.find((item) => item.staffId === staffId) ?? null;
  const payPerson = staffRows.find((person) => person.id === staffId) ?? null;

  return (
    <ProductionComplianceDetail
      record={record}
      section={section}
      kioskPerson={kioskPerson}
      account={account}
      adminConfigured={accountData.adminConfigured}
      payPerson={payPerson}
      commercialAccess={actor.kind === "commercial"}
    />
  );
}
