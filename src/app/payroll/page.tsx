import { PayrollScreen } from "@/components/payroll/payroll-screen";
import { CommercialPayrollReportingScreen, ProductionPayrollScreen } from "@/components/payroll/production-payroll-screen";
import { AppShell } from "@/components/layout/app-shell";
import { ManagerHelpLink } from "@/components/help/manager-help-link";
import { ManagerPageNav } from "@/components/layout/manager-page-nav";
import { getAppMode } from "@/lib/app-mode";
import { requireAttendanceDateRange } from "@/lib/attendance/date-range";
import { isoDateInLondon } from "@/lib/dates/format";
import { createPayrollPreparationRow } from "@/lib/payroll/calculations";
import { loadPayrollAttendanceReviews, loadProductionAttendanceData, loadProductionStaffRows } from "@/lib/payroll/server";
import { loadAttendanceReviewReadiness } from "@/lib/attendance/review-server";
import { loadOfflinePayrollReadiness } from "@/lib/payroll/offline-readiness-server";
import { createPayrollOperationId, loadCommercialPayrollReportingState, loadPayrollWorkspace } from "@/lib/payroll/tenant-server";

export const dynamic = "force-dynamic";

const payPageNav = [
  { id: "export", label: "Export pay hours", href: "/payroll" },
  { id: "import", label: "Import pay details", href: "/payroll/review" },
  { id: "details", label: "Pay details", href: "/payroll/arrangements" },
];

export default async function PayrollPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (getAppMode() === "demo") return <PayrollScreen />;
  const params = await searchParams;
  const today = isoDateInLondon();
  const [year, month] = today.split("-").map(Number);
  const defaultStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const defaultEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const range = requireAttendanceDateRange(
    typeof params.from === "string" ? params.from : defaultStart,
    typeof params.to === "string" ? params.to : defaultEnd,
  );
  const periodStart = range.from;
  const periodEnd = range.to;
  const includeInactive = params.inactive === "1";
  const includeManagers = params.managers === "1";
  const includeZero = params.zero !== "0";
  const actor = await loadPayrollWorkspace({ periodStart, periodEnd });
  if (actor.kind === "commercial") {
    const reporting = await loadCommercialPayrollReportingState(actor.context, { periodStart, periodEnd });
    return (
      <AppShell>
        <div className="mb-5">
          <h1 className="text-3xl font-black text-purple-950">Payroll reporting</h1>
          <p className="mt-2 text-slate-600">
            Review organisation-owned preparation totals and export only an approved stored revision. This is not completed payroll.
          </p>
        </div>
        <ManagerPageNav items={payPageNav} activeId="export" label="Pay hours sections" />
        <div className="pt-5">
          <CommercialPayrollReportingScreen
            organisationDisplayName={actor.context.organisationDisplayName}
            siteId={actor.context.selectedSiteId}
            snapshot={actor.workspace.snapshot}
            reporting={reporting}
            canPrepare={actor.context.permissions.includes("payroll.prepare")}
            canExport={actor.context.permissions.includes("payroll.export")}
            operationIds={{
              create: createPayrollOperationId(),
              prepare: createPayrollOperationId(),
              acknowledge: createPayrollOperationId(),
              approve: createPayrollOperationId(),
              adjustment: createPayrollOperationId(),
              reopen: createPayrollOperationId(),
              resolveAdjustment: createPayrollOperationId(),
            }}
          />
        </div>
      </AppShell>
    );
  }
  const [staff, attendance, reviews, reviewReadiness, offlineReadiness] = await Promise.all([
    loadProductionStaffRows(),
    loadProductionAttendanceData(periodStart, periodEnd),
    loadPayrollAttendanceReviews(periodStart, periodEnd),
    loadAttendanceReviewReadiness(periodStart, periodEnd),
    loadOfflinePayrollReadiness(periodStart, periodEnd),
  ]);
  const rows = staff
    .filter((person) => (includeInactive || person.active) && (includeManagers || !person.isManager))
    .map((person) => createPayrollPreparationRow(
      person,
      attendance.audit.originalEvents,
      attendance.effectiveEvents,
      periodStart,
      periodEnd,
      reviews,
    ))
    .filter((row) => includeZero || row.recordedMinutes > 0 || row.adjustedMinutes > 0);
  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-3xl font-black text-purple-950">Export pay hours</h1>
        <p className="mt-2 text-slate-600">
          Check planned and recorded hours, then download a workbook. This is not completed payroll.
        </p>
        <ManagerHelpLink taskId="export-pay-hours" />
      </div>
      <ManagerPageNav items={payPageNav} activeId="export" label="Pay hours sections" />
      <div className="pt-5">
        <ProductionPayrollScreen
          rows={rows}
          periodStart={periodStart}
          periodEnd={periodEnd}
          includeInactive={includeInactive}
          includeManagers={includeManagers}
          includeZero={includeZero}
          reviewReadiness={reviewReadiness}
          offlineReadiness={offlineReadiness}
        />
      </div>
    </AppShell>
  );
}
