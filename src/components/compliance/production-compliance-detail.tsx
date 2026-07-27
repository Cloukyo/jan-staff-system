import Link from "next/link";
import type { ProductionAccountRow } from "@/lib/accounts/server";
import { AppShell } from "@/components/layout/app-shell";
import { EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { StaffRecordClocking } from "@/components/staff/staff-record-clocking";
import { StaffRecordLogin } from "@/components/staff/staff-record-login";
import { StaffRecordNav } from "@/components/staff/staff-record-nav";
import { StaffRecordPay } from "@/components/staff/staff-record-pay";
import {
  archiveComplianceRecordAction,
  saveCertificateAction,
  saveCentralRecordAction,
  saveCentralRecordItemAction,
  saveQualificationAction,
  saveReferenceAction,
  updateStaffProfileAction,
} from "@/lib/compliance/actions";
import type { StaffComplianceRecord } from "@/lib/compliance/repository";
import { centralRecordCompletion, certificateStatus, certificateStatusLabel, certificateStatusTone, maskDbsNumber } from "@/lib/calculations/compliance";
import { formatDateUk } from "@/lib/dates/format";
import type { ManagerKioskRow } from "@/lib/kiosk/server";
import type { ProductionStaffRow } from "@/lib/payroll/types";
import type { StaffRecordSection } from "@/lib/staff/record-sections";

const checklist = [
  ["appointment_induction", "Appointment and induction"],
  ["contract_form", "Contract form"],
  ["id_checked", "ID checked"],
  ["address_evidence", "Address evidence"],
  ["employment_tax_evidence", "Employment or tax evidence"],
  ["dbs_recorded", "DBS recorded"],
  ["dbs_update_service", "DBS update service"],
  ["references", "References"],
  ["starter_form", "Starter form"],
  ["suitability_declaration", "Staff suitability declaration"],
  ["medical_declaration", "Medical declaration"],
  ["employee_information_form", "Employee information form"],
];

export function ProductionComplianceDetail({
  record,
  section,
  kioskPerson,
  account,
  adminConfigured,
  payPerson,
}: {
  record: StaffComplianceRecord;
  section: StaffRecordSection;
  kioskPerson: ManagerKioskRow | null;
  account: ProductionAccountRow | null;
  adminConfigured: boolean;
  payPerson: ProductionStaffRow | null;
}) {
  const { staff, centralRecord } = record;
  const central = centralRecordCompletion(centralRecord, record.centralItems);
  const loginReady = (!staff.email && !record.account?.email)
    || Boolean(record.account?.active && record.account.authUserId);
  const employmentReady = Boolean(
    staff.fullName.trim()
    && staff.displayName.trim()
    && staff.employmentRole.trim()
    && staff.appointmentDate,
  );
  const trainingReady = Boolean(
    record.qualifications.length
    && record.certificates.length
    && record.references.length
    && central.completed === central.total,
  );
  const payReady = Boolean(payPerson?.payArrangements.length);
  return (
    <AppShell>
      <div className="mb-6">
        <Link className="text-sm font-bold text-purple-700" href="/staff">Back to staff records</Link>
        <p className="mt-3 text-sm font-bold text-green-700">Production data · Supabase</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">{staff.fullName}</h1>
        <p className="mt-2 text-sm text-slate-600">{staff.employmentRole}</p>
      </div>

      <StaffRecordNav staffId={staff.id} section={section} />

      <div className="grid gap-4">
        {section === "overview" && (
          <StaffRecordOverview
            items={[
              ["Employment details complete", employmentReady],
              ["Can use Staff Clock", Boolean(kioskPerson?.kioskEnabled)],
              ["PIN ready", Boolean(kioskPerson?.pinReady)],
              ["Staff login enabled or not required", loginReady],
              ["Required training and checks", trainingReady],
              ["Pay details present", payReady],
            ]}
          />
        )}

        {section === "employment" && (
        <Panel>
          <h2 className="text-xl font-black text-purple-950">Employment</h2>
          <ProductionActionForm action={updateStaffProfileAction}>
            <input type="hidden" name="staffId" value={staff.id} />
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="Full legal name"><input className={inputClassName()} name="fullName" defaultValue={staff.fullName} required /></Field>
              <Field label="Name shown on Staff Clock"><input className={inputClassName()} name="displayName" defaultValue={staff.displayName} /></Field>
              <Field label="Role"><input className={inputClassName()} name="employmentRole" defaultValue={staff.employmentRole} required /></Field>
              <Field label="Main qualification"><input className={inputClassName()} name="mainQualificationLevel" defaultValue={staff.mainQualificationLevel ?? ""} /></Field>
              <Field label="Start date"><input className={inputClassName()} name="appointmentDate" type="date" defaultValue={staff.appointmentDate ?? ""} /></Field>
              <Field label="Email"><input className={inputClassName()} name="email" type="email" defaultValue={staff.email ?? account?.email ?? ""} /></Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-4">
              <label className="flex min-h-11 items-center gap-2 font-bold text-purple-950"><input name="isApprentice" type="checkbox" defaultChecked={staff.isApprentice} /> Apprentice</label>
              <label className="flex min-h-11 items-center gap-2 font-bold text-purple-950"><input name="isCoverStaff" type="checkbox" defaultChecked={staff.isCoverStaff} /> Cover staff</label>
              <label className="flex min-h-11 items-center gap-2 font-bold text-purple-950"><input name="active" type="checkbox" defaultChecked={staff.active} /> Active</label>
            </div>
            <Field label="Notes"><textarea className={inputClassName("mt-3 min-h-24 w-full")} name="notes" defaultValue={staff.notes ?? ""} /></Field>
          </ProductionActionForm>
        </Panel>
        )}

        {section === "clocking-in" && (
          <StaffRecordClocking
            person={kioskPerson}
          />
        )}

        {section === "staff-login" && (
          <StaffRecordLogin
            account={account}
            staffId={staff.id}
            fullName={staff.fullName}
            email={staff.email ?? record.account?.email ?? null}
            adminConfigured={adminConfigured}
          />
        )}

        {section === "pay-details" && (
          payPerson
            ? <StaffRecordPay person={payPerson} />
            : <Panel><EmptyState title="Pay details unavailable" body="The staff pay record could not be loaded." /></Panel>
        )}

        {section === "training-checks" && (
          <>
            <nav aria-label="Training and checks sections" className="flex flex-wrap gap-2">
              {[
                ["qualifications", "Qualifications"],
                ["training-certificates", "Training and certificates"],
                ["dbs-suitability", "DBS and suitability"],
                ["central-record", "Central-record checklist"],
                ["references", "References"],
                ["import-warnings", "Import warnings"],
              ].map(([id, label]) => (
                <a
                  key={id}
                  className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200"
                  href={`#${id}`}
                >
                  {label}
                </a>
              ))}
            </nav>
        <Panel>
          <h2 id="qualifications" className="scroll-mt-44 text-xl font-black text-purple-950 md:scroll-mt-36 lg:scroll-mt-16">Qualifications</h2>
          <div className="mt-4 grid gap-4">
            {record.qualifications.map((item) => (
              <div key={item.id} className="rounded-xl border border-purple-100 p-4">
                <ProductionActionForm action={saveQualificationAction}>
                  <input type="hidden" name="staffId" value={staff.id} /><input type="hidden" name="qualificationId" value={item.id} />
                  <QualificationFields item={item} />
                </ProductionActionForm>
                <ArchiveForm table="staff_qualifications" id={item.id} staffId={staff.id} />
              </div>
            ))}
            {!record.qualifications.length && <EmptyState title="No qualifications" body="Add the first qualification below." />}
            <div className="rounded-xl bg-purple-50 p-4">
              <h3 className="font-black text-purple-950">Add qualification</h3>
              <ProductionActionForm action={saveQualificationAction}>
                <input type="hidden" name="staffId" value={staff.id} />
                <QualificationFields />
              </ProductionActionForm>
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 id="training-certificates" className="scroll-mt-44 text-xl font-black text-purple-950 md:scroll-mt-36 lg:scroll-mt-16">Training and certificates</h2>
          <div className="mt-4 grid gap-4">
            {record.certificates.map((item) => {
              const status = certificateStatus(item);
              return (
                <div key={item.id} className="rounded-xl border border-purple-100 p-4">
                  <StatusPill tone={certificateStatusTone(status)}>{certificateStatusLabel(status)}</StatusPill>
                  <ProductionActionForm action={saveCertificateAction}>
                    <input type="hidden" name="staffId" value={staff.id} /><input type="hidden" name="certificateId" value={item.id} />
                    <CertificateFields item={item} />
                  </ProductionActionForm>
                  <ArchiveForm table="staff_certificates" id={item.id} staffId={staff.id} />
                </div>
              );
            })}
            {!record.certificates.length && <EmptyState title="No certificates" body="Add the first certificate below." />}
            <div className="rounded-xl bg-purple-50 p-4">
              <h3 className="font-black text-purple-950">Add certificate</h3>
              <ProductionActionForm action={saveCertificateAction}>
                <input type="hidden" name="staffId" value={staff.id} />
                <CertificateFields />
              </ProductionActionForm>
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 id="dbs-suitability" className="scroll-mt-44 text-xl font-black text-purple-950 md:scroll-mt-36 lg:scroll-mt-16">DBS and suitability</h2>
          <p className="mt-2 text-sm font-bold text-purple-800">Central record: {central.completed}/{central.total}</p>
          <ProductionActionForm action={saveCentralRecordAction}>
            <input type="hidden" name="staffId" value={staff.id} />
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="flex min-h-11 items-center gap-2 font-bold text-purple-950"><input name="dbsRecorded" type="checkbox" defaultChecked={centralRecord?.dbsRecorded} /> DBS recorded</label>
              <label className="flex min-h-11 items-center gap-2 font-bold text-purple-950"><input name="dbsUpdateService" type="checkbox" defaultChecked={centralRecord?.dbsUpdateService} /> Update service</label>
              <label className="flex min-h-11 items-center gap-2 font-bold text-purple-950"><input name="dbsNewCheckRequired" type="checkbox" defaultChecked={centralRecord?.dbsNewCheckRequired} /> New DBS required</label>
              <Field label="DBS number (last four only)"><input className={inputClassName()} name="dbsNumberLast4" defaultValue={centralRecord?.dbsNumberLast4 ?? ""} maxLength={4} placeholder={maskDbsNumber(centralRecord?.dbsNumberLast4)} /></Field>
              <Field label="Issue date"><input className={inputClassName()} name="dbsIssueDate" type="date" defaultValue={centralRecord?.dbsIssueDate ?? ""} /></Field>
              <Field label="Last checked"><input className={inputClassName()} name="dbsLastCheckedAt" type="date" defaultValue={centralRecord?.dbsLastCheckedAt ?? ""} /></Field>
            </div>
            <LegacyChecklistHidden record={centralRecord} />
            <Field label="Manager notes"><textarea className={inputClassName("mt-3 min-h-20 w-full")} name="notes" defaultValue={centralRecord?.notes ?? ""} /></Field>
          </ProductionActionForm>
        </Panel>

        <Panel>
          <h2 id="central-record" className="scroll-mt-44 text-xl font-black text-purple-950 md:scroll-mt-36 lg:scroll-mt-16">Central-record checklist</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {checklist.map(([key, label]) => {
              const item = record.centralItems.find((entry) => entry.itemKey === key);
              return (
                <ProductionActionForm key={key} action={saveCentralRecordItemAction} submitLabel="Save item" submitVariant="secondary" className="rounded-xl border border-purple-100 p-3">
                  <input type="hidden" name="staffId" value={staff.id} /><input type="hidden" name="itemKey" value={key} />
                  <p className="font-bold text-purple-950">{label}</p>
                  <select className={inputClassName("mt-2 w-full")} name="status" defaultValue={item?.status ?? "incomplete"}><option value="complete">Complete</option><option value="incomplete">Incomplete</option><option value="not_applicable">Not applicable</option></select>
                  <input className={inputClassName("mt-2 w-full")} name="checkedAt" type="date" defaultValue={item?.checkedAt ?? ""} />
                  <input className={inputClassName("mt-2 w-full")} name="notes" defaultValue={item?.notes ?? ""} placeholder="Notes" />
                </ProductionActionForm>
              );
            })}
          </div>
        </Panel>

        <Panel>
          <h2 id="references" className="scroll-mt-44 text-xl font-black text-purple-950 md:scroll-mt-36 lg:scroll-mt-16">References</h2>
          <div className="mt-4 grid gap-4">
            {record.references.map((item) => <div key={item.id} className="rounded-xl border border-purple-100 p-4"><ProductionActionForm action={saveReferenceAction}><input type="hidden" name="staffId" value={staff.id} /><input type="hidden" name="referenceId" value={item.id} /><ReferenceFields item={item} /></ProductionActionForm><ArchiveForm table="staff_reference_checks" id={item.id} staffId={staff.id} /></div>)}
            <div className="rounded-xl bg-purple-50 p-4"><h3 className="font-black text-purple-950">Add reference</h3><ProductionActionForm action={saveReferenceAction}><input type="hidden" name="staffId" value={staff.id} /><ReferenceFields /></ProductionActionForm></div>
          </div>
        </Panel>

        <Panel>
          <h2 id="import-warnings" className="scroll-mt-44 text-xl font-black text-purple-950 md:scroll-mt-36 lg:scroll-mt-16">Import warnings</h2>
          {record.importWarnings.length ? record.importWarnings.map((warning) => <div key={warning.id} className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>{warning.status}</strong>{warning.warnings.map((text) => <p key={text}>{text}</p>)}</div>) : <EmptyState title="No import warnings" body="No import-review warnings are linked to this profile." />}
          <p className="mt-4 text-sm text-slate-600">Created {formatDateUk(staff.createdAt)}. Updated {formatDateUk(staff.updatedAt)}.</p>
        </Panel>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StaffRecordOverview({
  items,
}: {
  items: Array<[label: string, complete: boolean]>;
}) {
  return (
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Setup checklist</h2>
      <p className="mt-2 text-sm text-slate-600">
        Open a section above to complete anything that still needs attention.
      </p>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {items.map(([label, complete]) => (
          <li
            key={label}
            className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-purple-100 px-4 py-3"
          >
            <span className="font-bold text-purple-950">{label}</span>
            <StatusPill tone={complete ? "green" : "amber"}>
              {complete ? "Complete" : "Needs setup"}
            </StatusPill>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function QualificationFields({ item }: { item?: StaffComplianceRecord["qualifications"][number] }) {
  return <div className="mt-3 grid gap-3 md:grid-cols-3"><Field label="Qualification name"><input className={inputClassName()} name="qualificationName" defaultValue={item?.qualificationName ?? ""} required /></Field><Field label="Level"><input className={inputClassName()} name="qualificationLevel" defaultValue={item?.qualificationLevel ?? ""} /></Field><Field label="Awarding organisation"><input className={inputClassName()} name="awardingOrganisation" defaultValue={item?.awardingOrganisation ?? ""} /></Field><Field label="Award date"><input className={inputClassName()} name="awardDate" type="date" defaultValue={item?.awardDate ?? ""} /></Field><Field label="Expected completion"><input className={inputClassName()} name="expectedCompletionDate" type="date" defaultValue={item?.expectedCompletionDate ?? ""} /></Field><Field label="Evidence status"><select className={inputClassName()} name="evidenceStatus" defaultValue={item?.evidenceStatus ?? "awaiting"}><option value="awaiting">Awaiting</option><option value="received">Received</option><option value="verified">Verified</option><option value="not_required">Not required</option></select></Field><label className="font-bold text-purple-950"><input name="permanent" type="checkbox" defaultChecked={item?.permanent ?? true} /> Permanent</label><label className="font-bold text-purple-950"><input name="verified" type="checkbox" defaultChecked={Boolean(item?.verifiedAt)} /> Verified</label><Field label="Notes"><input className={inputClassName()} name="notes" defaultValue={item?.notes ?? ""} /></Field></div>;
}

function CertificateFields({ item }: { item?: StaffComplianceRecord["certificates"][number] }) {
  return <div className="mt-3 grid gap-3 md:grid-cols-3"><Field label="Training type"><input className={inputClassName()} name="certificateType" defaultValue={item?.certificateType ?? ""} required /></Field><Field label="Custom title"><input className={inputClassName()} name="customTitle" defaultValue={item?.customTitle ?? ""} /></Field><Field label="Completion date"><input className={inputClassName()} name="completionDate" type="date" defaultValue={item?.completionDate ?? ""} /></Field><Field label="Confirmed expiry date"><input className={inputClassName()} name="expiryDate" type="date" defaultValue={item?.expiryDate ?? ""} /></Field><Field label="Validity months"><input className={inputClassName()} name="validityMonths" type="number" min="1" defaultValue={item?.validityMonths ?? ""} /></Field><Field label="Evidence status"><select className={inputClassName()} name="evidenceStatus" defaultValue={item?.evidenceStatus ?? "awaiting"}><option value="awaiting">Awaiting</option><option value="received">Received</option><option value="verified">Verified</option><option value="not_required">Not required</option></select></Field><label className="font-bold text-purple-950"><input name="noExpiry" type="checkbox" defaultChecked={item?.permanent ?? false} /> No expiry/permanent</label><label className="font-bold text-purple-950"><input name="verified" type="checkbox" defaultChecked={Boolean(item?.verifiedAt)} /> Verified</label><Field label="Notes"><input className={inputClassName()} name="notes" defaultValue={item?.notes ?? ""} /></Field></div>;
}

function ReferenceFields({ item }: { item?: StaffComplianceRecord["references"][number] }) {
  return <div className="mt-3 grid gap-3 md:grid-cols-3"><Field label="Reference type"><select className={inputClassName()} name="referenceType" defaultValue={item?.referenceType ?? "current_last_employer"}><option value="current_last_employer">Current or last employer</option><option value="previous_employer">Previous employer</option><option value="alternative">Alternative</option></select></Field><Field label="Referee or organisation"><input className={inputClassName()} name="referenceName" defaultValue={item?.referenceName ?? ""} /></Field><Field label="Method"><select className={inputClassName()} name="method" defaultValue={item?.method ?? "written"}><option value="written">Written</option><option value="telephone">Telephone</option><option value="email">Email</option></select></Field><Field label="Date checked"><input className={inputClassName()} name="checkedAt" type="date" defaultValue={item?.checkedAt ?? ""} /></Field><label className="font-bold text-purple-950"><input name="satisfactory" type="checkbox" defaultChecked={item?.satisfactory === true} /> Satisfactory</label><Field label="Notes"><input className={inputClassName()} name="notes" defaultValue={item?.notes ?? ""} /></Field></div>;
}

function ArchiveForm({ table, id, staffId }: { table: string; id: string; staffId: string }) {
  return <ProductionActionForm action={archiveComplianceRecordAction} submitLabel="Archive" submitVariant="danger" className="mt-2"><input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} /><input type="hidden" name="staffId" value={staffId} /></ProductionActionForm>;
}

function LegacyChecklistHidden({ record }: { record: StaffComplianceRecord["centralRecord"] }) {
  if (!record) return null;
  const fields = ["appointmentInductionCompleted", "contractForm", "idChecked", "addressEvidenceChecked", "additionalEmploymentTaxEvidenceChecked", "referencesComplete", "starterForm", "suitabilityDeclaration", "medicalDeclaration", "employeeInformationForm"] as const;
  return <>{fields.filter((key) => record[key]).map((key) => <input key={key} type="hidden" name={key} value="true" />)}</>;
}
