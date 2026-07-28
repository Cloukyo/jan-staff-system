import { AppShell } from "@/components/layout/app-shell";
import { ManagerPageNav } from "@/components/layout/manager-page-nav";
import { PayArrangementsScreen } from "@/components/payroll/pay-arrangements-screen";
import { requireAccount } from "@/lib/auth/permissions";
import { loadProductionStaffRows } from "@/lib/payroll/server";

export const dynamic = "force-dynamic";

const payPageNav = [
  { id: "export", label: "Export pay hours", href: "/payroll" },
  { id: "import", label: "Import pay details", href: "/payroll/review" },
  { id: "details", label: "Pay details", href: "/payroll/arrangements" },
];

export default async function PayArrangementsPage() {
  await requireAccount(["manager"]);
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
