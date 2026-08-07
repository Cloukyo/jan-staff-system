"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import type { PayrollPreparationRow } from "@/lib/payroll/types";
import { Button, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatHours, formatMoney } from "@/lib/dates/format";
import type { PayrollExportHoursMode } from "@/lib/exports/payroll-options";
import type { OfflinePayrollReadiness } from "@/lib/payroll/offline-readiness";
import type { CommercialPayrollSnapshot } from "@/lib/payroll/tenant-types";
import {
  summariseCommercialPayrollReporting,
  type CommercialPayrollReportingState,
} from "@/lib/payroll/reporting";
import {
  acknowledgeBoundCommercialPayrollWarningsAction,
  approveBoundCommercialPayrollPreparationAction,
  createBoundCommercialPayrollAdjustmentAction,
  createBoundCommercialPayrollPeriodAction,
  persistBoundCommercialPayrollPreparationAction,
  replaceBoundCommercialPayrollAdjustmentAction,
  reopenBoundCommercialPayrollPreparationAction,
  resolveBoundCommercialPayrollAdjustmentAction,
} from "@/lib/payroll/tenant-actions";
import type { CommercialPayrollActionState } from "@/lib/payroll/tenant-actions";

const initialCommercialActionState: CommercialPayrollActionState = {
  ok: false,
  code: "",
  message: "",
};

function CommercialPayrollActionForm({
  action,
  operationId,
  submitLabel,
  children,
}: {
  action: (state: CommercialPayrollActionState, formData: FormData) => Promise<CommercialPayrollActionState>;
  operationId: string;
  submitLabel: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialCommercialActionState);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok]);
  return (
    <form action={formAction} data-operation-id={operationId}>
      {children}
      {state.message ? <p className={`mt-3 text-sm font-bold ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p> : null}
      <Button className="mt-3" type="submit" disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </form>
  );
}

function derivePayrollOperationId(base: string, discriminator: string): string {
  let hash = 2_166_136_261;
  for (const character of discriminator) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${base.slice(0, -8)}${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function CommercialPayrollReportingScreen({
  organisationDisplayName,
  siteId,
  snapshot,
  reporting,
  canPrepare,
  canExport,
  operationIds,
}: {
  organisationDisplayName: string;
  siteId: string | null;
  snapshot: CommercialPayrollSnapshot;
  reporting: CommercialPayrollReportingState;
  canPrepare: boolean;
  canExport: boolean;
  operationIds: {
    create: string;
    prepare: string;
    acknowledge: string;
    approve: string;
    adjustment: string;
    reopen: string;
    resolveAdjustment: string;
  };
}) {
  const summary = summariseCommercialPayrollReporting(reporting);
  const exportScopeMatches = reporting.run?.siteFilterId === siteId;
  const exportParams = reporting.period
    && reporting.approval?.status === "approved"
    && reporting.isFresh
    && exportScopeMatches
    ? new URLSearchParams({
      from: snapshot.periodStart,
      to: snapshot.periodEnd,
      period: reporting.period.id,
      approval: reporting.approval.id,
      revision: String(reporting.period.revision),
      ...(siteId ? { site: siteId } : {}),
    })
    : null;
  const reportingScopeLabel = reporting.run
    ? reporting.run.siteFilterDisplayName
      ? `Stored run site: ${reporting.run.siteFilterDisplayName}`
      : "Stored run scope: all authorised sites"
    : reporting.selectedSiteDisplayName
      ? `Selected site: ${reporting.selectedSiteDisplayName}`
      : "Selected scope: all authorised sites";
  const createAction = createBoundCommercialPayrollPeriodAction.bind(null, {
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    operationId: operationIds.create,
  });
  const prepareAction = reporting.period
    ? persistBoundCommercialPayrollPreparationAction.bind(null, {
      periodId: reporting.period.id,
      expectedRevision: reporting.period.revision,
      operationId: operationIds.prepare,
      snapshot,
    })
    : null;
  const approveAction = reporting.period && reporting.run
    ? approveBoundCommercialPayrollPreparationAction.bind(null, {
      periodId: reporting.period.id,
      expectedRevision: reporting.period.revision,
      operationId: operationIds.approve,
    })
    : null;
  const acknowledgeAction = reporting.period && reporting.run
    ? acknowledgeBoundCommercialPayrollWarningsAction.bind(null, {
      periodId: reporting.period.id,
      expectedRevision: reporting.period.revision,
      operationId: operationIds.acknowledge,
    })
    : null;
  const reopenAction = reporting.period && reporting.approval
    ? reopenBoundCommercialPayrollPreparationAction.bind(null, {
      periodId: reporting.period.id,
      expectedRevision: reporting.period.revision,
      operationId: operationIds.reopen,
    })
    : null;

  return (
    <div className="grid gap-5">
      <Panel>
        <p className="text-sm font-bold text-slate-500">Organisation</p>
        <h2 className="text-xl font-black text-purple-950">{organisationDisplayName}</h2>
        <p className="mt-1 text-sm text-slate-600">{reportingScopeLabel}</p>
        <p className="mt-1 text-sm font-bold text-purple-800">{summary.sourceLabel}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-purple-100 p-3"><p className="text-xs font-bold text-slate-500">{summary.totalLabel}</p><p className="mt-1 text-xl font-black">{formatHours(summary.totalMinutes)}</p></div>
          <div className="rounded-lg border border-purple-100 p-3"><p className="text-xs font-bold text-slate-500">Adjustment total</p><p className="mt-1 text-xl font-black">{formatHours(summary.adjustmentMinutes)}</p></div>
          <div className="rounded-lg border border-purple-100 p-3"><p className="text-xs font-bold text-slate-500">Staff</p><p className="mt-1 text-xl font-black">{summary.staffRows.length}</p></div>
          <div className="rounded-lg border border-purple-100 p-3"><p className="text-xs font-bold text-slate-500">Pay categories</p><p className="mt-1 text-sm font-black">{Object.entries(summary.categoryCounts).map(([key, count]) => `${key}: ${count}`).join(" | ") || "None stored"}</p></div>
        </div>
        {summary.siteTotals.length ? (
          <div className="mt-4 rounded-lg border border-purple-100 p-3">
            <p className="text-xs font-bold text-slate-500">Site-attributed payable time</p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm font-bold">
              {summary.siteTotals.map((row) => <span key={row.siteId ?? "unattributed"}>{row.siteDisplayName}: {formatHours(row.payableMinutes)}</span>)}
            </div>
          </div>
        ) : <p className="mt-4 text-sm text-slate-600">Save a preparation revision to create stored reporting totals.</p>}
      </Panel>

      <Panel>
        <h2 className="font-black text-purple-950">Preparation and approval</h2>
        <p className="mt-2 text-sm text-slate-600">
          Period status: {reporting.period?.status ?? "not created"} | Run status: {reporting.run?.status ?? "not prepared"} | Revision: {reporting.period?.revision ?? "not assigned"} | Approval: {reporting.approval?.status ?? "not approved"}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Stored readiness: {summary.blockerCount} blocker(s), {summary.warningCount} warning(s), {summary.informationalCount} information item(s).
        </p>
        {canPrepare && !reporting.period ? <CommercialPayrollActionForm action={createAction} operationId={operationIds.create} submitLabel="Create payroll period" /> : null}
        {reporting.run && !reporting.isFresh ? (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="font-bold text-amber-950">Payroll inputs changed after this revision was saved.</p>
            <p className="mt-1 text-sm text-amber-900">Recalculate before approving or exporting this preparation.</p>
          </div>
        ) : null}
        {canPrepare && reporting.period?.status === "open" && (!reporting.run || !reporting.isFresh) && prepareAction ? (
          <CommercialPayrollActionForm
            action={prepareAction}
            operationId={operationIds.prepare}
            submitLabel={reporting.run ? "Recalculate preparation" : "Save preparation revision"}
          />
        ) : null}
        {canPrepare && reporting.isFresh && reporting.period?.status === "open" && reporting.run && reporting.run.warningCount > 0
          && !reporting.run.warningsAcknowledged && acknowledgeAction ? (
          <CommercialPayrollActionForm action={acknowledgeAction} operationId={operationIds.acknowledge} submitLabel="Acknowledge warnings">
            {(reporting.run.warningCodes ?? []).map((code) => <input key={code} type="hidden" name="warningCode" value={code} />)}
            <Field label="Acknowledgement note">
              <textarea className={inputClassName("min-h-24")} name="note" minLength={5} maxLength={2000} required />
            </Field>
          </CommercialPayrollActionForm>
        ) : null}
        {canPrepare && reporting.isFresh && reporting.period?.status === "open" && reporting.run?.status === "ready"
          && (reporting.run.warningCount === 0 || reporting.run.warningsAcknowledged)
          && !reporting.approval && approveAction
          ? <CommercialPayrollActionForm action={approveAction} operationId={operationIds.approve} submitLabel="Approve exact revision" /> : null}
        {canPrepare && reporting.period?.status === "closed" && reporting.approval?.status === "approved" && reopenAction ? (
          <CommercialPayrollActionForm action={reopenAction} operationId={operationIds.reopen} submitLabel="Reopen approved revision">
            <Field label="Reopen reason">
              <textarea className={inputClassName("min-h-24")} name="reason" minLength={5} maxLength={2000} required />
            </Field>
          </CommercialPayrollActionForm>
        ) : null}
        {canExport && exportParams ? (
          <a className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" href={`/payroll/export?${exportParams.toString()}`}>
            <FileSpreadsheet className="h-4 w-4" /> Export approved revision
          </a>
        ) : null}
        {canExport && reporting.approval?.status === "approved" && !exportScopeMatches ? (
          <p className="mt-3 text-sm font-bold text-amber-800">Select the stored run site scope before exporting.</p>
        ) : null}
        {reporting.lastExport ? <p className="mt-3 text-xs text-slate-500">Last export: {reporting.lastExport.fileName} from revision {reporting.lastExport.revision}</p> : null}
      </Panel>

      {canPrepare && reporting.isFresh && reporting.period?.status === "open" && reporting.run ? (
        <Panel>
          <h2 className="font-black text-purple-950">Manager adjustments</h2>
          <p className="mt-2 text-sm text-slate-600">Use signed minutes. Positive values add payable time and negative values remove it. Attendance evidence is unchanged.</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {reporting.adjustmentTargets.map((adjustmentTarget) => {
              const operationId = derivePayrollOperationId(
                operationIds.adjustment,
                `create:${adjustmentTarget.key}`,
              );
              const action = createBoundCommercialPayrollAdjustmentAction.bind(null, {
                periodId: reporting.period!.id,
                expectedRevision: reporting.period!.revision,
                operationId,
                target: adjustmentTarget.target,
              });
              return (
                <div key={adjustmentTarget.key} className="rounded-xl border border-purple-100 p-4">
                  <p className="font-bold text-purple-950">{adjustmentTarget.label}</p>
                  <CommercialPayrollActionForm action={action} operationId={operationId} submitLabel="Add signed adjustment">
                    <input type="hidden" name="targetKind" value={adjustmentTarget.target.kind} />
                    <input type="hidden" name="targetStaffId" value={adjustmentTarget.target.staffId} />
                    {adjustmentTarget.target.siteId !== null ? <input type="hidden" name="targetSiteId" value={adjustmentTarget.target.siteId} /> : null}
                    {adjustmentTarget.target.kind === "attendance" ? <input type="hidden" name="targetOperationalDate" value={adjustmentTarget.target.operationalDate} /> : null}
                    <Field label="Signed minutes">
                      <input className={inputClassName()} name="adjustmentMinutes" type="number" min={-10080} max={10080} step={1} required />
                    </Field>
                    <Field label="Adjustment reason">
                      <textarea className={inputClassName("min-h-24")} name="reason" minLength={5} maxLength={2000} required />
                    </Field>
                  </CommercialPayrollActionForm>
                </div>
              );
            })}
          </div>
          {(reporting.adjustments ?? []).map((adjustment) => (
            <div key={adjustment.id} className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-bold text-amber-950">Active adjustment: {adjustment.adjustmentMinutes > 0 ? "+" : ""}{adjustment.adjustmentMinutes} minutes</p>
              <p className="mt-1 text-sm text-amber-900">{adjustment.reason}</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                {(["replace", "void", "reverse"] as const).map((resolution) => {
                  const operationId = derivePayrollOperationId(
                    operationIds.resolveAdjustment,
                    `${resolution}:${adjustment.id}`,
                  );
                  if (resolution === "replace") {
                    const action = replaceBoundCommercialPayrollAdjustmentAction.bind(null, {
                      periodId: reporting.period!.id,
                      expectedRevision: reporting.period!.revision,
                      operationId,
                      adjustmentId: adjustment.id,
                    });
                    return <CommercialPayrollActionForm key={resolution} action={action} operationId={operationId} submitLabel="Replace adjustment">
                      <Field label="Replacement signed minutes">
                        <input className={inputClassName()} name="adjustmentMinutes" type="number" min={-10080} max={10080} step={1} required />
                      </Field>
                      <Field label="Replacement reason">
                        <textarea className={inputClassName("min-h-20")} name="reason" minLength={5} maxLength={2000} required />
                      </Field>
                    </CommercialPayrollActionForm>;
                  }
                  const action = resolveBoundCommercialPayrollAdjustmentAction.bind(null, {
                    periodId: reporting.period!.id,
                    expectedRevision: reporting.period!.revision,
                    operationId,
                    adjustmentId: adjustment.id,
                    resolution,
                  });
                  return <CommercialPayrollActionForm key={resolution} action={action} operationId={operationId} submitLabel={resolution === "void" ? "Void adjustment" : "Reverse adjustment"}>
                    <Field label={resolution === "void" ? "Void reason" : "Reverse reason"}>
                      <textarea className={inputClassName("min-h-20")} name="reason" minLength={5} maxLength={2000} required />
                    </Field>
                  </CommercialPayrollActionForm>;
                })}
              </div>
            </div>
          ))}
        </Panel>
      ) : null}

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-purple-100"><th className="p-2">Staff</th><th className="p-2">Pay category</th><th className="p-2">Payable</th><th className="p-2">Ordinary</th><th className="p-2">Overtime</th><th className="p-2">Estimated preparation value</th></tr></thead>
            <tbody>{summary.staffRows.map((row) => <tr key={row.staffId} className="border-b border-purple-50"><td className="p-2"><strong>{row.fullName}</strong><br /><span className="text-slate-500">{row.employmentRole}</span></td><td className="p-2">{row.payType ?? "Missing"}</td><td className="p-2">{formatHours(row.payableMinutes)}</td><td className="p-2">{formatHours(row.ordinaryMinutes)}</td><td className="p-2">{formatHours(row.overtimeMinutes)}</td><td className="p-2">{formatMoney(row.estimatedGrossValue === null ? null : Math.round(row.estimatedGrossValue * 100))}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>
      <p className="text-sm font-bold text-purple-800">Payroll preparation only. No PAYE, National Insurance, pension or statutory deductions are calculated.</p>
    </div>
  );
}

export function ProductionPayrollScreen({
  rows,
  periodStart,
  periodEnd,
  includeInactive,
  includeManagers,
  includeZero,
  reviewReadiness,
  offlineReadiness,
}: {
  rows: PayrollPreparationRow[];
  periodStart: string;
  periodEnd: string;
  includeInactive: boolean;
  includeManagers: boolean;
  includeZero: boolean;
  reviewReadiness: { unresolved: number; pendingRequests: number; openExceptions: number };
  offlineReadiness: OfflinePayrollReadiness;
}) {
  const router = useRouter();
  const [start, setStart] = useState(periodStart);
  const [end, setEnd] = useState(periodEnd);
  const [confirmExportOpen, setConfirmExportOpen] = useState(false);
  const [exportHours, setExportHours] = useState<PayrollExportHoursMode>("both");
  const attendanceIncomplete =
    reviewReadiness.unresolved > 0 || reviewReadiness.pendingRequests > 0
      || reviewReadiness.openExceptions > 0 || offlineReadiness.status !== "ready";
  function apply() {
    router.push(`/payroll?from=${start}&to=${end}&inactive=${includeInactive ? "1" : "0"}&managers=${includeManagers ? "1" : "0"}&zero=${includeZero ? "1" : "0"}`);
  }
  function download(confirmed = false) {
    const query = new URLSearchParams({
      from: periodStart,
      to: periodEnd,
      inactive: includeInactive ? "1" : "0",
      managers: includeManagers ? "1" : "0",
      zero: includeZero ? "1" : "0",
      hours: exportHours,
      confirmUnreviewed: confirmed ? "1" : "0",
    });
    window.location.assign(`/payroll/export?${query.toString()}`);
  }
  function requestDownload() {
    if (attendanceIncomplete && exportHours !== "planned") {
      setConfirmExportOpen(true);
      return;
    }
    download();
  }
  return (
    <div className="grid gap-5">
      <Panel>
        {reviewReadiness.unresolved || reviewReadiness.pendingRequests || reviewReadiness.openExceptions ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
            Attendance review is incomplete: {reviewReadiness.openExceptions} attendance issue(s), {reviewReadiness.unresolved} unreviewed worked day(s) and {reviewReadiness.pendingRequests} staff correction request(s) remain open. <a className="underline" href={`/attendance?status=open&from=${periodStart}&to=${periodEnd}`}>Review attendance issues</a>.
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-bold text-green-900">Attendance records in this period have review decisions and no staff requests remain open.</div>
        )}
        {offlineReadiness.status !== "ready" ? (
          <div className={`mb-4 rounded-lg border p-4 text-sm ${offlineReadiness.status === "not_ready" ? "border-red-200 bg-red-50 text-red-950" : "border-amber-200 bg-amber-50 text-amber-950"}`} role="alert">
            <p className="font-black">Offline attendance evidence: {offlineReadiness.status === "not_ready" ? "Not ready" : "Ready with warnings"}</p>
            <p className="mt-2 font-semibold">{offlineReadiness.unresolvedConflicts} unresolved sync conflict(s), {offlineReadiness.reportedPendingActions} action(s) reported pending, {offlineReadiness.unknownQueueDevices} device(s) with unknown queue state, {offlineReadiness.staleOfflineDevices} device(s) offline since before this payroll period, {offlineReadiness.revokedEvidenceDevices} revoked device(s) that may retain evidence and {offlineReadiness.acceptedDriftWarnings} accepted clock-drift warning(s).</p>
            <a className="mt-2 inline-block font-bold underline" href="/settings/kiosk">Review kiosk health</a>
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <Field label="Period start"><input className={inputClassName()} type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
          <Field label="Period end"><input className={inputClassName()} type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
          <label className="flex items-end gap-2 pb-3 font-bold"><input type="checkbox" defaultChecked={includeInactive} onChange={(event) => router.push(`/payroll?from=${start}&to=${end}&inactive=${event.target.checked ? "1" : "0"}&managers=${includeManagers ? "1" : "0"}&zero=${includeZero ? "1" : "0"}`)} /> Include inactive</label>
          <label className="flex items-end gap-2 pb-3 font-bold"><input type="checkbox" defaultChecked={includeManagers} onChange={(event) => router.push(`/payroll?from=${start}&to=${end}&inactive=${includeInactive ? "1" : "0"}&managers=${event.target.checked ? "1" : "0"}&zero=${includeZero ? "1" : "0"}`)} /> Include manager profile</label>
          <label className="flex items-end gap-2 pb-3 font-bold"><input type="checkbox" defaultChecked={includeZero} onChange={(event) => router.push(`/payroll?from=${start}&to=${end}&inactive=${includeInactive ? "1" : "0"}&managers=${includeManagers ? "1" : "0"}&zero=${event.target.checked ? "1" : "0"}`)} /> Include zero hours</label>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(16rem,22rem)_auto] sm:items-end">
          <Field label="Hours to include">
            <select
              className={inputClassName()}
              value={exportHours}
              onChange={(event) => {
                setExportHours(event.target.value as PayrollExportHoursMode);
                setConfirmExportOpen(false);
              }}
            >
              <option value="both">Both planned and clocked</option>
              <option value="planned">Planned hours only</option>
              <option value="clocked">Clocked hours only</option>
            </select>
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button onClick={apply}>Preview period</Button>
            <Button variant="secondary" onClick={requestDownload}>
              <FileSpreadsheet className="h-4 w-4" /> Export Excel
            </Button>
          </div>
        </div>
        {confirmExportOpen && attendanceIncomplete && exportHours !== "planned" ? (
          <div
            className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4"
            role="alert"
          >
            <p className="font-black text-amber-950">Export unreviewed attendance?</p>
            <p className="mt-2 text-sm text-amber-900">
              These hours may be inaccurate. {reviewReadiness.openExceptions} attendance issue(s), {reviewReadiness.unresolved} worked day(s)
              without review and {reviewReadiness.pendingRequests} staff correction
              request(s) remain open. Offline evidence status is {offlineReadiness.status.replaceAll("_", " ")} with {offlineReadiness.reportedPendingActions} reported pending action(s) and {offlineReadiness.unresolvedConflicts} unresolved sync conflict(s). Check and correct the workbook manually before
              using it for payroll.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={() => download(true)}>
                <FileSpreadsheet className="h-4 w-4" /> Export unreviewed Excel
              </Button>
              <Button variant="secondary" onClick={() => setConfirmExportOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        <p className="mt-3 text-sm font-bold text-purple-800">Payroll preparation only. No PAYE, National Insurance, pension or statutory deductions are calculated.</p>
      </Panel>
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-purple-100"><th className="p-2">Staff</th><th className="p-2">Type</th><th className="p-2">Contract</th><th className="p-2">Raw worked</th><th className="p-2">Reviewed worked</th><th className="p-2">Ordinary</th><th className="p-2">Overtime</th><th className="p-2">Review</th><th className="p-2">Basis</th><th className="p-2">Warnings</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.staffId} className="border-b border-purple-50 align-top"><td className="p-2"><strong>{row.fullName}</strong><br /><span className="text-slate-500">{row.employmentRole}</span></td><td className="p-2">{row.payType ?? "Missing"}</td><td className="p-2">{row.contractedWeeklyHours === null ? row.hoursBasis?.replaceAll("_", " ") ?? "Missing" : `${row.contractedWeeklyHours} weekly`}</td><td className="p-2">{formatHours(row.recordedMinutes)}</td><td className="p-2">{formatHours(row.adjustedMinutes)}</td><td className="p-2">{formatHours(row.ordinaryMinutes)}</td><td className="p-2">{formatHours(row.overtimeMinutes)}</td><td className="p-2"><StatusPill tone={row.reviewStatus === "ready" ? "green" : row.reviewStatus === "unresolved" ? "amber" : "grey"}>{row.reviewedDays}/{row.workedDays} days reviewed</StatusPill>{row.adjustmentNotes.map((note) => <p key={note} className="mt-1 text-xs text-slate-600">{note}</p>)}</td><td className="p-2">{row.payType === "hourly" ? `${formatMoney(row.hourlyRate === null ? null : Math.round(row.hourlyRate * 100))} / hour | estimated ${formatMoney(row.estimatedGross === null ? null : Math.round(row.estimatedGross * 100))}` : row.payType === "salaried" ? `Salary period basis ${formatMoney(row.salaryBasis === null ? null : Math.round(row.salaryBasis * 100))}` : "-"}</td><td className="p-2">{row.warnings.length ? row.warnings.map((warning) => <p key={warning} className="mb-1 text-xs font-bold text-amber-700">{warning}</p>) : <StatusPill tone="green">Clear</StatusPill>}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
