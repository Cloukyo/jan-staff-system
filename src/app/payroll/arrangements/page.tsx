import { AppShell } from "@/components/layout/app-shell";
import { ManagerPageNav } from "@/components/layout/manager-page-nav";
import { CommercialPayArrangementsScreen, PayArrangementsScreen } from "@/components/payroll/pay-arrangements-screen";
import { loadProductionStaffRows } from "@/lib/payroll/server";
import { isoDateInLondon } from "@/lib/dates/format";
import { loadCommercialPayArrangementHistory, loadPayrollWorkspace } from "@/lib/payroll/tenant-server";

export const dynamic = "force-dynamic";

const payPageNav = [
  { id: "export", label: "Export pay hours", href: "/payroll" },
  { id: "import", label: "Import pay details", href: "/payroll/review" },
  { id: "details", label: "Pay details", href: "/payroll/arrangements" },
];

export default async function PayArrangementsPage() {
  const today = isoDateInLondon();
  const actor = await loadPayrollWorkspace({ periodStart: today, periodEnd: today });
  if (actor.kind === "commercial") {
    const history = await loadCommercialPayArrangementHistory(actor.context);
    return (
      <AppShell>
        <div className="mb-5">
          <h1 className="text-3xl font-black text-purple-950">Pay details</h1>
          <p className="mt-2 text-slate-600">View organisation-owned pay arrangements and preserved effective-dated history.</p>
        </div>
        <ManagerPageNav items={payPageNav} activeId="details" label="Pay hours sections" />
        <div className="pt-5">
          <CommercialPayArrangementsScreen
            organisationDisplayName={actor.context.organisationDisplayName}
            staff={history.staff}
            arrangements={history.payArrangements}
            canPrepare={actor.context.permissions.includes("payroll.prepare")}
          />
        </div>
      </AppShell>
    );
  }
  const staff = await loadProductionStaffRows();
  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-3xl font-black text-purple-950">Pay details</h1>
        <p className="mt-2 text-slate-600">
          View pay rates and salaries, add changes from a chosen date, and keep previous details.
        </p>
      </div>
      <ManagerPageNav items={payPageNav} activeId="details" label="Pay hours sections" />
      <div className="pt-5">
        <PayArrangementsScreen staff={staff} />
      </div>
    </AppShell>
  );
}
