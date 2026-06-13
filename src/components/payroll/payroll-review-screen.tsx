"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { PayrollActionForm } from "@/components/payroll/payroll-action-form";
import { Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import {
  createPayrollReviewBatchAction,
  importPayrollBatchAction,
  markPayrollBatchReadyAction,
  savePayrollReviewRowAction,
  updatePayrollBatchDateConfirmationAction,
} from "@/lib/payroll/review-actions";
import type { PayrollImportBatch, PayrollImportReviewRow, PayrollReviewSummary } from "@/lib/payroll/review";
import { formatDateUk, formatMoney } from "@/lib/dates/format";

type ProfileOption = { id: string; fullName: string; active: boolean };

const summaryLabels: Array<[keyof PayrollReviewSummary, string]> = [
  ["totalRows", "Source rows"],
  ["resolvedRows", "Resolved"],
  ["unresolvedRows", "Unresolved"],
  ["excludedRows", "Excluded"],
  ["formerRows", "Former staff"],
  ["externalRows", "External"],
  ["missingRates", "Missing rates"],
  ["missingHours", "Missing hours"],
  ["duplicateMappings", "Duplicate mappings"],
  ["effectiveDateConflicts", "Date conflicts"],
  ["rowsWithWarnings", "Rows with warnings"],
];

export function PayrollReviewScreen({
  batches,
  batch,
  rows,
  profiles,
  summary,
  warningsByRow,
}: {
  batches: PayrollImportBatch[];
  batch: PayrollImportBatch | null;
  rows: PayrollImportReviewRow[];
  profiles: ProfileOption[];
  summary: PayrollReviewSummary | null;
  warningsByRow: Record<string, string[]>;
}) {
  const editable = batch?.status === "draft";
  return (
    <div className="grid gap-5">
      <Panel>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 text-purple-700" aria-hidden />
          <div>
            <h2 className="font-black text-purple-950">Private manager review</h2>
            <p className="mt-1 text-sm text-slate-600">Workbook values are stored only in manager-protected Supabase tables. Creating or editing a review does not create pay arrangements.</p>
          </div>
        </div>
        <PayrollActionForm action={createPayrollReviewBatchAction} submitLabel="Create private review batch" className="mt-5">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Payroll workbook (.xlsx)"><input className={inputClassName()} name="workbook" type="file" accept=".xlsx" required /></Field>
            <Field label="Proposed effective date"><input className={inputClassName()} name="proposedEffectiveDate" type="date" required /></Field>
          </div>
        </PayrollActionForm>
      </Panel>

      {batches.length ? (
        <Panel>
          <h2 className="font-black text-purple-950">Review batches</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {batches.map((item) => (
              <Link key={item.id} href={`/payroll/review?batch=${item.id}`} className={`rounded-lg px-3 py-2 text-sm font-bold ring-1 ${item.id === batch?.id ? "bg-purple-700 text-white ring-purple-700" : "bg-white text-purple-900 ring-purple-200"}`}>
                {item.sourceFilename} · {item.status}
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}

      {!batch || !summary ? (
        <Panel><p className="font-bold text-purple-950">No payroll review batch has been created.</p></Panel>
      ) : (
        <>
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-500">Selected review</p>
                <h2 className="mt-1 text-xl font-black text-purple-950">{batch.sourceFilename}</h2>
                <p className="mt-1 text-sm text-slate-600">Created {formatDateUk(batch.createdAt.slice(0, 10))}</p>
              </div>
              <StatusPill tone={batch.status === "imported" ? "green" : batch.status === "ready" ? "purple" : "amber"}>{batch.status}</StatusPill>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {summaryLabels.map(([key, label]) => (
                <div key={key} className="rounded-lg border border-purple-100 p-3">
                  <p className="text-xs font-bold text-slate-500">{label}</p>
                  <p className="mt-1 text-xl font-black text-purple-950">{summary[key]}</p>
                </div>
              ))}
              <div className={`rounded-lg border p-3 ${summary.readyForImport ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
                <p className="text-xs font-bold text-slate-600">Ready for import</p>
                <p className="mt-1 text-xl font-black">{summary.readyForImport ? "Yes" : "No"}</p>
              </div>
            </div>
            {editable ? (
              <PayrollActionForm action={updatePayrollBatchDateConfirmationAction} submitLabel="Save date confirmation" className="mt-5 border-t border-purple-100 pt-5">
                <input type="hidden" name="batchId" value={batch.id} />
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Proposed effective date"><input className={inputClassName()} name="proposedEffectiveDate" type="date" defaultValue={batch.proposedEffectiveDate ?? ""} required /></Field>
                  <label className="flex min-h-11 items-center gap-2 pt-6 text-sm font-bold text-purple-950">
                    <input name="globalEffectiveDateConfirmed" type="checkbox" defaultChecked={batch.globalEffectiveDateConfirmed} />
                    Confirm this date may apply to every importable row
                  </label>
                </div>
              </PayrollActionForm>
            ) : null}
          </Panel>

          <div className="grid gap-4">
            {rows.map((row) => (
              <ReviewRow key={row.id} row={row} batchId={batch.id} profiles={profiles} warnings={warningsByRow[row.id] ?? []} editable={editable} />
            ))}
          </div>

          {batch.status === "draft" ? (
            <Panel>
              <h2 className="font-black text-purple-950">Approve review</h2>
              <p className="mt-1 text-sm text-slate-600">Approval locks the batch. It still does not create any pay arrangements.</p>
              <PayrollActionForm action={markPayrollBatchReadyAction} submitLabel="Approve and lock review">
                <input type="hidden" name="batchId" value={batch.id} />
              </PayrollActionForm>
            </Panel>
          ) : null}

          {batch.status === "ready" ? (
            <Panel>
              <h2 className="font-black text-purple-950">Final production import</h2>
              <p className="mt-1 text-sm text-slate-600">This creates effective-dated pay arrangements. Existing overlapping arrangements will block the transaction.</p>
              <PayrollActionForm action={importPayrollBatchAction} submitLabel="Import approved arrangements">
                <input type="hidden" name="batchId" value={batch.id} />
                <Field label='Type "IMPORT" to confirm'><input className={inputClassName("mt-3")} name="confirmation" autoComplete="off" required /></Field>
              </PayrollActionForm>
            </Panel>
          ) : null}
        </>
      )}
    </div>
  );
}

function ReviewRow({ row, batchId, profiles, warnings, editable }: {
  row: PayrollImportReviewRow;
  batchId: string;
  profiles: ProfileOption[];
  warnings: string[];
  editable: boolean;
}) {
  const suggested = profiles.find((profile) => profile.id === row.suggestedStaffId);
  const salaryPeriod = row.annualSalary !== null ? "annual" : row.monthlySalary !== null ? "monthly" : "";
  const salaryBasis = row.annualSalary ?? row.monthlySalary;
  return (
    <Panel className={warnings.length ? "border-amber-200" : "border-green-200"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-purple-950">{row.sourceName}</h2>
          <p className="text-sm text-slate-600">Source row {row.sourceRowIndex} · Suggested match: {suggested?.fullName ?? "None"} · {row.matchConfidence} confidence</p>
        </div>
        <StatusPill tone={warnings.length ? "amber" : "green"}>{warnings.length ? `${warnings.length} warning(s)` : "Ready"}</StatusPill>
      </div>
      {row.sourceWarnings.length ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          {row.sourceWarnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}
      {editable ? (
        <PayrollActionForm action={savePayrollReviewRowAction} submitLabel="Save review row" className="mt-4">
          <input type="hidden" name="rowId" value={row.id} />
          <input type="hidden" name="batchId" value={batchId} />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Classification">
              <select className={inputClassName()} name="resolution" defaultValue={row.resolution}>
                <option value="unresolved">Unresolved</option>
                <option value="current_staff">Current staff</option>
                <option value="former_staff">Former staff</option>
                <option value="external">External or casual non-staff</option>
                <option value="excluded">Exclude</option>
              </select>
            </Field>
            <Field label="Canonical staff profile">
              <select className={inputClassName()} name="selectedStaffId" defaultValue={row.selectedStaffId ?? ""}>
                <option value="">Select staff</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.fullName}{profile.active ? "" : " (inactive)"}</option>)}
              </select>
            </Field>
            <Field label="Pay type">
              <select className={inputClassName()} name="payType" defaultValue={row.payType ?? ""}>
                <option value="">Choose</option><option value="hourly">Hourly</option><option value="salaried">Salaried</option>
              </select>
            </Field>
            <Field label="Hourly rate"><input className={inputClassName()} name="hourlyRate" type="number" min="0" step="0.01" defaultValue={row.hourlyRate ?? ""} /></Field>
            <Field label="Salary basis"><input className={inputClassName()} name="salaryBasis" type="number" min="0" step="0.01" defaultValue={salaryBasis ?? ""} /></Field>
            <Field label="Salary period">
              <select className={inputClassName()} name="salaryPeriod" defaultValue={salaryPeriod}>
                <option value="">Choose</option><option value="annual">Annual</option><option value="monthly">Monthly</option>
              </select>
            </Field>
            <Field label="Contracted weekly hours"><input className={inputClassName()} name="contractedWeeklyHours" type="number" min="0" max="80" step="0.25" defaultValue={row.contractedWeeklyHours ?? ""} /></Field>
            <Field label="Hours basis">
              <select className={inputClassName()} name="hoursBasis" defaultValue={row.hoursBasis}>
                <option value="contracted">Contracted hours</option>
                <option value="variable_hours">Variable hours</option>
                <option value="casual">Casual</option>
                <option value="zero_hours">Zero hours</option>
                <option value="salaried_untracked">Salaried, hours not tracked</option>
              </select>
            </Field>
            <Field label="Effective from"><input className={inputClassName()} name="effectiveFrom" type="date" defaultValue={row.effectiveFrom ?? ""} /></Field>
            <label className="flex min-h-11 items-center gap-2 pt-6 text-sm font-bold text-purple-950">
              <input name="duplicateMappingConfirmed" type="checkbox" defaultChecked={row.duplicateMappingConfirmed} />
              Confirm separate arrangement if duplicated
            </label>
            <Field label="Private manager notes"><input className={inputClassName()} name="managerNotes" defaultValue={row.managerNotes ?? ""} /></Field>
          </div>
        </PayrollActionForm>
      ) : (
        <div className="mt-4 grid gap-2 text-sm md:grid-cols-3">
          <p><strong>Classification:</strong> {row.resolution.replaceAll("_", " ")}</p>
          <p><strong>Pay type:</strong> {row.payType ?? "Not applicable"}</p>
          <p><strong>Hours basis:</strong> {row.hoursBasis.replaceAll("_", " ")}</p>
          <p><strong>Effective date:</strong> {row.effectiveFrom ? formatDateUk(row.effectiveFrom) : "Not applicable"}</p>
          <p><strong>Pay basis:</strong> {row.payType === "hourly" ? formatMoney(row.hourlyRate === null ? null : Math.round(row.hourlyRate * 100)) : formatMoney(salaryBasis === null ? null : Math.round(salaryBasis * 100))}</p>
        </div>
      )}
      {warnings.length ? <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
    </Panel>
  );
}
