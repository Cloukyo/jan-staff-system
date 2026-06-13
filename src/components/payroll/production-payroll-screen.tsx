"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PayrollPreparationRow } from "@/lib/payroll/types";
import { Button, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { createCsvContent } from "@/lib/exports/csv";
import { formatHours, formatMoney } from "@/lib/dates/format";

export function ProductionPayrollScreen({
  rows,
  periodStart,
  periodEnd,
  includeInactive,
  includeManagers,
  includeZero,
  reviewReadiness,
}: {
  rows: PayrollPreparationRow[];
  periodStart: string;
  periodEnd: string;
  includeInactive: boolean;
  includeManagers: boolean;
  includeZero: boolean;
  reviewReadiness: { unresolved: number; pendingRequests: number };
}) {
  const router = useRouter();
  const [start, setStart] = useState(periodStart);
  const [end, setEnd] = useState(periodEnd);
  function apply() {
    router.push(`/payroll?from=${start}&to=${end}&inactive=${includeInactive ? "1" : "0"}&managers=${includeManagers ? "1" : "0"}&zero=${includeZero ? "1" : "0"}`);
  }
  function download() {
    const content = createCsvContent([
      ["Staff", "Role", "Pay type", "Contracted weekly hours", "Recorded hours", "Adjusted hours", "Ordinary hours", "Overtime hours", "Hourly rate", "Estimated gross", "Salary basis", "Warnings"],
      ...rows.map((row) => [
        row.fullName, row.employmentRole, row.payType ?? "", row.contractedWeeklyHours ?? "",
        (row.recordedMinutes / 60).toFixed(2), (row.adjustedMinutes / 60).toFixed(2),
        (row.ordinaryMinutes / 60).toFixed(2), (row.overtimeMinutes / 60).toFixed(2),
        row.hourlyRate ?? "", row.estimatedGross ?? "", row.salaryBasis ?? "", row.warnings.join("; "),
      ]),
    ]);
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `jan-payroll-preparation-${periodStart}-to-${periodEnd}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return (
    <div className="grid gap-5">
      <Panel>
        {reviewReadiness.unresolved || reviewReadiness.pendingRequests ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
            Attendance review is incomplete: {reviewReadiness.unresolved} worked day(s) are not reviewed and {reviewReadiness.pendingRequests} staff correction request(s) remain open.
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-bold text-green-900">Attendance records in this period have review decisions and no staff requests remain open.</div>
        )}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <Field label="Period start"><input className={inputClassName()} type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
          <Field label="Period end"><input className={inputClassName()} type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
          <label className="flex items-end gap-2 pb-3 font-bold"><input type="checkbox" defaultChecked={includeInactive} onChange={(event) => router.push(`/payroll?from=${start}&to=${end}&inactive=${event.target.checked ? "1" : "0"}&managers=${includeManagers ? "1" : "0"}&zero=${includeZero ? "1" : "0"}`)} /> Include inactive</label>
          <label className="flex items-end gap-2 pb-3 font-bold"><input type="checkbox" defaultChecked={includeManagers} onChange={(event) => router.push(`/payroll?from=${start}&to=${end}&inactive=${includeInactive ? "1" : "0"}&managers=${event.target.checked ? "1" : "0"}&zero=${includeZero ? "1" : "0"}`)} /> Include manager profile</label>
          <label className="flex items-end gap-2 pb-3 font-bold"><input type="checkbox" defaultChecked={includeZero} onChange={(event) => router.push(`/payroll?from=${start}&to=${end}&inactive=${includeInactive ? "1" : "0"}&managers=${includeManagers ? "1" : "0"}&zero=${event.target.checked ? "1" : "0"}`)} /> Include zero hours</label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3"><Button onClick={apply}>Preview period</Button><Button variant="secondary" disabled={reviewReadiness.unresolved > 0 || reviewReadiness.pendingRequests > 0} onClick={download}>Export CSV</Button></div>
        <p className="mt-3 text-sm font-bold text-purple-800">Payroll preparation only. No PAYE, National Insurance, pension or statutory deductions are calculated.</p>
      </Panel>
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-purple-100"><th className="p-2">Staff</th><th className="p-2">Type</th><th className="p-2">Recorded</th><th className="p-2">Adjusted</th><th className="p-2">Ordinary</th><th className="p-2">Overtime</th><th className="p-2">Basis</th><th className="p-2">Warnings</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.staffId} className="border-b border-purple-50 align-top"><td className="p-2"><strong>{row.fullName}</strong><br /><span className="text-slate-500">{row.employmentRole}</span></td><td className="p-2">{row.payType ?? "Missing"}</td><td className="p-2">{formatHours(row.recordedMinutes)}</td><td className="p-2">{formatHours(row.adjustedMinutes)}</td><td className="p-2">{formatHours(row.ordinaryMinutes)}</td><td className="p-2">{formatHours(row.overtimeMinutes)}</td><td className="p-2">{row.payType === "hourly" ? `${formatMoney(row.hourlyRate === null ? null : Math.round(row.hourlyRate * 100))} / hour | estimated ${formatMoney(row.estimatedGross === null ? null : Math.round(row.estimatedGross * 100))}` : row.payType === "salaried" ? `Salary basis ${formatMoney(row.salaryBasis === null ? null : Math.round(row.salaryBasis * 100))}` : "-"}</td><td className="p-2">{row.warnings.length ? row.warnings.map((warning) => <p key={warning} className="mb-1 text-xs font-bold text-amber-700">{warning}</p>) : <StatusPill tone="green">Clear</StatusPill>}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
