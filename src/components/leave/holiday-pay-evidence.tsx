"use client";

import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { Field, Panel, inputClassName } from "@/components/ui/primitives";
import { formatDateUk, formatDurationCompact, formatMoney, isoDateInLondon } from "@/lib/dates/format";
import { recordHolidayPayEvidenceAction, type HolidayPayEvidencePage } from "@/lib/retention/server";

export function HolidayPayEvidence({ data }: { data: HolidayPayEvidencePage }) {
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-3xl font-black text-purple-950">Leave and holiday pay records</h1><p className="mt-2 text-slate-600">Record confirmed holiday pay evidence. This does not calculate payroll or statutory deductions.</p></div>
      <a className="inline-flex min-h-11 items-center rounded-xl border border-purple-200 bg-white px-4 text-sm font-bold text-purple-900" href="/leave/records/export">Download retained records</a>
    </div>
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Record amount actually paid</h2>
      <ProductionActionForm action={recordHolidayPayEvidenceAction} submitLabel="Record payment evidence" className="mt-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Approved annual leave"><select className={inputClassName()} name="leaveRequestId" required><option value="">Choose leave</option>{data.approvedLeave.map((leave) => <option key={leave.id} value={leave.id}>{leave.staffName}: {formatDateUk(leave.startDate)} to {formatDateUk(leave.endDate)}</option>)}</select></Field>
          <Field label="Payment date"><input className={inputClassName()} name="paidOn" type="date" defaultValue={isoDateInLondon()} required /></Field>
          <Field label="Holiday pay actually paid (GBP)"><input className={inputClassName()} name="amountPaid" type="number" min="0" step="0.01" required /></Field>
          <Field label="Evidence note"><input className={inputClassName()} name="evidenceNote" minLength={5} maxLength={2000} placeholder="For example, confirmed from payroll report" required /></Field>
        </div>
      </ProductionActionForm>
    </Panel>
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Retained evidence</h2>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead><tr className="border-b border-purple-100"><th className="p-2">Staff</th><th className="p-2">Paid on</th><th className="p-2">Leave</th><th className="p-2">Amount paid</th><th className="p-2">Evidence note</th><th className="p-2">Retain until</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id} className="border-b border-purple-50"><td className="p-2 font-bold">{row.staffName}</td><td className="p-2">{formatDateUk(row.paidOn)}</td><td className="p-2">{formatDurationCompact(row.leaveMinutes)}</td><td className="p-2">{formatMoney(row.amountPaidPence)}</td><td className="p-2">{row.evidenceNote}</td><td className="p-2">{row.retainedUntil ? formatDateUk(row.retainedUntil) : "Policy review required"}</td></tr>)}</tbody></table>{!data.rows.length ? <p className="py-6 text-sm text-slate-600">No holiday pay evidence has been recorded.</p> : null}</div>
    </Panel>
  </div>;
}
