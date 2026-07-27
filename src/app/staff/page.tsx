import { StaffScreen } from "@/components/staff/staff-screen";
import { AddStaffForm } from "@/components/staff/add-staff-form";
import { ProductionStaffScreen } from "@/components/staff/production-staff-screen";
import { AppShell } from "@/components/layout/app-shell";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { loadProductionStaffRows, toStaffDirectoryRows } from "@/lib/payroll/server";

export const dynamic = "force-dynamic";

type StaffPageSearchParams = {
  action?: string;
  filter?: string;
};

export default async function StaffPage({ searchParams }: { searchParams: Promise<StaffPageSearchParams> }) {
  if (getAppMode() === "demo") return <StaffScreen />;
  await requireAccount(["manager"]);
  const { action, filter } = await searchParams;
  const adding = action === "add";
  const initialFilter = filter === "inactive"
    ? "inactive"
    : filter === "needs-setup" || filter === "needs-checks"
      ? "needs-setup"
      : "active";
  const directoryStaff = adding
    ? []
    : toStaffDirectoryRows(await loadProductionStaffRows());
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-purple-950">Staff records</h1>
          <p className="mt-2 text-slate-600">Add staff and manage their employment, clocking-in and setup details.</p>
        </div>
        {!adding ? (
          <Link
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-purple-700 px-5 text-sm font-bold text-white hover:bg-purple-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700 sm:w-auto"
            href="/staff?action=add"
          >
            <Plus aria-hidden className="h-5 w-5" />
            Add staff member
          </Link>
        ) : null}
      </div>
      {adding
        ? <AddStaffForm />
        : <ProductionStaffScreen initialFilter={initialFilter} staff={directoryStaff} />}
    </AppShell>
  );
}
