import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { ProductionActionForm } from "@/components/compliance/production-action-form";
import {
  centralRecordCompletion,
  certificateStatus,
  certificateStatusLabel,
  certificateStatusTone,
  complianceDashboardCounts,
  findCertificate,
  overallComplianceIndicator,
} from "@/lib/calculations/compliance";
import { createStaffProfileAction, quickUpdateStaffProfileAction } from "@/lib/compliance/actions";
import type { ComplianceDataset } from "@/lib/compliance/repository";
import { formatDateUk } from "@/lib/dates/format";

export function ProductionComplianceScreen({ data }: { data: ComplianceDataset }) {
  const today = new Date();
  const counts = complianceDashboardCounts(data.staff, data.certificates, data.centralRecords, today, data.centralItems);
  return (
    <AppShell>
      <div className="mb-6">
        <p className="text-sm font-bold text-green-700">Production data · Supabase</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">Staff Compliance</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">All records and summary counts below are loaded from Supabase under the signed-in manager session.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Active staff", counts.activeStaff, "purple"],
          ["Expired certificates", counts.expired, "red"],
          ["Expiring 0 to 30 days", counts.expiring30, "amber"],
          ["Expiring 31 to 60 days", counts.expiring60, "amber"],
          ["Expiring 61 to 90 days", counts.expiring90, "amber"],
          ["Missing first aid", counts.missingFirstAid, "red"],
          ["Missing safeguarding", counts.missingSafeguarding, "red"],
          ["Incomplete central records", counts.incompleteCentralRecords, "amber"],
        ].map(([label, value, tone]) => <Panel key={label as string}><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-purple-950">{value}</p><StatusPill tone={tone as "purple" | "red" | "amber"}>Live</StatusPill></Panel>)}
      </div>
      <Panel className="mt-4">
        <h2 className="text-xl font-black text-purple-950">Add staff member</h2>
        <ProductionActionForm action={createStaffProfileAction} className="mt-4">
          <div className="grid gap-4 md:grid-cols-5">
            <Field label="Full name"><input className={inputClassName()} name="fullName" required /></Field>
            <Field label="Preferred name"><input className={inputClassName()} name="displayName" /></Field>
            <Field label="Role"><input className={inputClassName()} name="employmentRole" required /></Field>
            <Field label="Qualification"><input className={inputClassName()} name="mainQualificationLevel" /></Field>
            <Field label="Start date"><input className={inputClassName()} name="appointmentDate" type="date" /></Field>
          </div>
          <label className="mt-3 flex items-center gap-2 font-bold text-purple-950"><input name="active" type="checkbox" defaultChecked /> Active</label>
        </ProductionActionForm>
      </Panel>
      <Panel className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
            <thead><tr>{["Staff", "Quick role/qualification/status edit", "First aid", "Safeguarding", "DBS", "Central", "Next expiry", "Login", "Overall", "View"].map((header) => <th key={header} className="border-b border-purple-100 bg-purple-50 px-3 py-3 font-black text-purple-950 first:rounded-l-xl last:rounded-r-xl">{header}</th>)}</tr></thead>
            <tbody>
              {data.staff.map((person) => {
                const firstAid = findCertificate(data.certificates, person.id, ["first aid"]);
                const safeguarding = findCertificate(data.certificates, person.id, ["safeguarding"]);
                const firstAidStatus = firstAid ? certificateStatus(firstAid, today) : "awaiting_evidence";
                const safeguardingStatus = safeguarding ? certificateStatus(safeguarding, today) : "awaiting_evidence";
                const centralRecord = data.centralRecords.find((item) => item.staffId === person.id);
                const central = centralRecordCompletion(centralRecord, data.centralItems.filter((item) => item.staffId === person.id));
                const nextExpiry = [firstAid?.expiryDate, safeguarding?.expiryDate].filter(Boolean).sort()[0];
                const overall = overallComplianceIndicator({ firstAidStatus, safeguardingStatus, centralRecordPercent: central.percent });
                const account = data.accounts.find((item) => item.staffId === person.id);
                const login = !person.email && !account?.email ? "No login" : !(person.authUserId || account?.authUserId) ? "Email, no Auth link" : account?.active === false ? "Disabled login" : "Active login";
                return (
                  <tr key={person.id}>
                    <td className="border-b border-purple-50 px-3 py-3 font-bold text-purple-950">{person.fullName}<p className="text-xs font-normal text-slate-500">{person.mainQualificationLevel ?? "No qualification recorded"}</p></td>
                    <td className="border-b border-purple-50 px-3 py-3">
                      <ProductionActionForm action={quickUpdateStaffProfileAction} submitLabel="Save quick edit" submitVariant="secondary">
                        <input type="hidden" name="staffId" value={person.id} />
                        <div className="grid gap-2">
                          <input className={inputClassName("w-44")} name="employmentRole" defaultValue={person.employmentRole} />
                          <input className={inputClassName("w-44")} name="mainQualificationLevel" defaultValue={person.mainQualificationLevel ?? ""} />
                          <label className="flex items-center gap-2 font-bold"><input name="active" type="checkbox" defaultChecked={person.active} /> Active</label>
                        </div>
                      </ProductionActionForm>
                    </td>
                    <td className="border-b border-purple-50 px-3 py-3"><StatusPill tone={certificateStatusTone(firstAidStatus)}>{certificateStatusLabel(firstAidStatus)}</StatusPill></td>
                    <td className="border-b border-purple-50 px-3 py-3"><StatusPill tone={certificateStatusTone(safeguardingStatus)}>{certificateStatusLabel(safeguardingStatus)}</StatusPill></td>
                    <td className="border-b border-purple-50 px-3 py-3">{centralRecord?.dbsRecorded ? "Recorded" : "Missing"}</td>
                    <td className="border-b border-purple-50 px-3 py-3">{central.completed}/{central.total}</td>
                    <td className="border-b border-purple-50 px-3 py-3">{nextExpiry ? formatDateUk(nextExpiry) : "No expiry"}</td>
                    <td className="border-b border-purple-50 px-3 py-3">{login}</td>
                    <td className="border-b border-purple-50 px-3 py-3"><StatusPill tone={overall === "urgent" ? "red" : overall === "complete" ? "green" : "amber"}>{overall}</StatusPill></td>
                    <td className="border-b border-purple-50 px-3 py-3"><Link className="inline-flex min-h-11 items-center rounded-xl bg-purple-700 px-4 py-2 font-semibold text-white" href={`/compliance/staff/${person.id}`}>View</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
