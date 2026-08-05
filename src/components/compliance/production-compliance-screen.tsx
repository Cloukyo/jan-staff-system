import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
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
import { quickUpdateStaffProfileAction } from "@/lib/compliance/actions";
import type { ComplianceDataset } from "@/lib/compliance/repository";
import { formatDateUk } from "@/lib/dates/format";
import { getActiveIndustryProfile } from "@/lib/platform/industry-profile";
import { getCompliancePackForIndustry } from "@/lib/compliance/modules";

export function ProductionComplianceScreen({ data }: { data: ComplianceDataset }) {
  const today = new Date();
  const compliancePack = getCompliancePackForIndustry(getActiveIndustryProfile().id);
  const counts = complianceDashboardCounts(data.staff, data.certificates, data.centralRecords, today, data.centralItems, compliancePack);
  const certificateRequirements = compliancePack.requirements.filter((item) => item.kind === "certificate").slice(0, 2);
  const includesDbs = compliancePack.requirements.some((item) => item.kind === "dbs");
  const includesCentralRecord = compliancePack.requirements.some((item) => item.kind === "central_record");
  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-black text-purple-950">Training &amp; checks</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">Review staff training, certificates and central-record checks.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Active staff", counts.activeStaff, "purple"],
          ["Expired certificates", counts.expired, "red"],
          ["Expiring 0 to 30 days", counts.expiring30, "amber"],
          ["Expiring 31 to 60 days", counts.expiring60, "amber"],
          ["Expiring 61 to 90 days", counts.expiring90, "amber"],
          ...Object.entries(counts.missingRequirements).map(([requirementId, value]) => [
            `Missing ${compliancePack.requirements.find((item) => item.id === requirementId)?.label.toLowerCase() ?? requirementId}`,
            value,
            "red",
          ]),
        ].map(([label, value, tone]) => <Panel key={label as string}><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-purple-950">{value}</p><StatusPill tone={tone as "purple" | "red" | "amber"}>Live</StatusPill></Panel>)}
      </div>
      <Panel className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
            <thead><tr>{[
              "Staff",
              "Quick role/qualification edit",
              ...certificateRequirements.map((item) => item.label),
              ...(includesDbs ? ["DBS"] : []),
              ...(includesCentralRecord ? ["Central"] : []),
              "Next expiry",
              "Login",
              "Overall",
              "View",
            ].map((header) => <th key={header} className="border-b border-purple-100 bg-purple-50 px-3 py-3 font-black text-purple-950 first:rounded-l-xl last:rounded-r-xl">{header}</th>)}</tr></thead>
            <tbody>
              {data.staff.map((person) => {
                const requiredCertificates = certificateRequirements.map((requirement) => findCertificate(data.certificates, person.id, [...(requirement.certificateKeywords ?? [requirement.label])]));
                const requiredStatuses = requiredCertificates.map((certificate) => certificate ? certificateStatus(certificate, today) : "awaiting_evidence");
                const firstAidStatus = requiredStatuses[0] ?? "verified";
                const safeguardingStatus = requiredStatuses[1] ?? "verified";
                const centralRecord = data.centralRecords.find((item) => item.staffId === person.id);
                const central = centralRecordCompletion(centralRecord, data.centralItems.filter((item) => item.staffId === person.id));
                const nextExpiry = requiredCertificates.map((certificate) => certificate?.expiryDate).filter(Boolean).sort()[0];
                const overall = overallComplianceIndicator({ firstAidStatus, safeguardingStatus, centralRecordPercent: central.percent });
                const account = data.accounts.find((item) => item.staffId === person.id);
                const login = !person.email && !account?.email ? "No login" : !(person.authUserId || account?.authUserId) ? "Email, login not linked" : account?.active === false ? "Disabled login" : "Active login";
                return (
                  <tr key={person.id}>
                    <td className="border-b border-purple-50 px-3 py-3 font-bold text-purple-950">{person.fullName}<p className="text-xs font-normal text-slate-500">{person.mainQualificationLevel ?? "No qualification recorded"}</p></td>
                    <td className="border-b border-purple-50 px-3 py-3">
                      <ProductionActionForm action={quickUpdateStaffProfileAction} submitLabel="Save quick edit" submitVariant="secondary">
                        <input type="hidden" name="staffId" value={person.id} />
                        <div className="grid gap-2">
                          <input className={inputClassName("w-44")} name="employmentRole" defaultValue={person.employmentRole} />
                          <input className={inputClassName("w-44")} name="mainQualificationLevel" defaultValue={person.mainQualificationLevel ?? ""} />
                        </div>
                      </ProductionActionForm>
                    </td>
                    {requiredStatuses.map((status, index) => <td key={certificateRequirements[index].id} className="border-b border-purple-50 px-3 py-3"><StatusPill tone={certificateStatusTone(status)}>{certificateStatusLabel(status)}</StatusPill></td>)}
                    {includesDbs ? <td className="border-b border-purple-50 px-3 py-3">{centralRecord?.dbsRecorded ? "Recorded" : "Missing"}</td> : null}
                    {includesCentralRecord ? <td className="border-b border-purple-50 px-3 py-3">{central.completed}/{central.total}</td> : null}
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
