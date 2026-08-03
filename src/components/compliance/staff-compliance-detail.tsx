"use client";

import Link from "next/link";
import { addMonths, format, parseISO } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { Archive, Check, Plus, Save } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button, EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { centralRecordCompletion, certificateStatus, certificateStatusLabel, certificateStatusTone } from "@/lib/calculations/compliance";
import { createDemoComplianceState, demoComplianceStorageKey, type DemoComplianceState } from "@/lib/compliance/demo-data";
import { formatDateUk } from "@/lib/dates/format";
import type { EvidenceStatus, StaffCertificate, StaffQualification, StaffReferenceCheck } from "@/types";

const checklist = [
  ["appointmentInductionCompleted", "Appointment and induction"],
  ["contractForm", "Contract form"],
  ["idChecked", "ID checked"],
  ["addressEvidenceChecked", "Address evidence"],
  ["additionalEmploymentTaxEvidenceChecked", "Employment or tax evidence"],
  ["dbsRecorded", "DBS recorded"],
  ["dbsUpdateService", "DBS update service"],
  ["referencesComplete", "References"],
  ["starterForm", "Starter form"],
  ["suitabilityDeclaration", "Staff suitability declaration"],
  ["medicalDeclaration", "Medical declaration"],
  ["employeeInformationForm", "Employee information form"],
] as const;

function loadState(): DemoComplianceState {
  if (typeof window === "undefined") return createDemoComplianceState();
  const saved = window.localStorage.getItem(demoComplianceStorageKey);
  if (!saved) return createDemoComplianceState();
  try {
    return { ...createDemoComplianceState(), ...JSON.parse(saved) };
  } catch {
    return createDemoComplianceState();
  }
}

function saveState(state: DemoComplianceState) {
  window.localStorage.setItem(demoComplianceStorageKey, JSON.stringify(state));
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function StaffComplianceDetail({ staffId }: { staffId: string }) {
  const [state, setState] = useState<DemoComplianceState>(() => loadState());
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showDbs, setShowDbs] = useState(false);
  const staff = state.staff.find((person) => person.id === staffId);
  const qualifications = state.qualifications.filter((item) => item.staffId === staffId && !item.archivedAt);
  const certificates = state.certificates.filter((item) => item.staffId === staffId && !item.archivedAt);
  const centralRecord = state.centralRecords.find((item) => item.staffId === staffId);
  const references = state.references.filter((item) => item.staffId === staffId && !item.archivedAt);
  const central = centralRecordCompletion(centralRecord);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function persist(next: DemoComplianceState, success: string) {
    setState(next);
    saveState(next);
    setDirty(false);
    setMessage(success);
  }

  const blankQualification: StaffQualification = useMemo(() => ({
    id: uid("qual"),
    staffId,
    qualificationName: "",
    qualificationLevel: "",
    awardingOrganisation: "",
    awardDate: null,
    expectedCompletionDate: null,
    permanent: true,
    evidenceStatus: "awaiting",
    evidenceReference: null,
    notes: null,
    verifiedBy: null,
    verifiedAt: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), [staffId]);

  const blankCertificate: StaffCertificate = useMemo(() => ({
    id: uid("cert"),
    staffId,
    certificateType: "",
    customTitle: "",
    completionDate: null,
    expiryDate: null,
    validityMonths: null,
    permanent: false,
    evidenceStatus: "awaiting",
    evidenceReference: null,
    notes: null,
    verifiedBy: null,
    verifiedAt: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), [staffId]);

  function patchStaff(key: string, value: string | boolean | null) {
    setDirty(true);
    setState((current) => ({ ...current, staff: current.staff.map((person) => person.id === staffId ? { ...person, [key]: value } : person) }));
  }

  function saveStaff() {
    const person = state.staff.find((item) => item.id === staffId);
    if (!person?.fullName.trim() || !person.employmentRole.trim()) {
      setMessage("Full name and role are required.");
      return;
    }
    persist({ ...state, staff: state.staff.map((item) => item.id === staffId ? { ...item, active: item.active, updatedAt: new Date().toISOString() } : item) }, "Staff details saved.");
  }

  function upsertQualification(qualification: StaffQualification) {
    if (!qualification.qualificationName.trim()) {
      setMessage("Qualification name is required.");
      return;
    }
    const exists = state.qualifications.some((item) => item.id === qualification.id);
    persist({ ...state, qualifications: exists ? state.qualifications.map((item) => item.id === qualification.id ? { ...qualification, updatedAt: new Date().toISOString() } : item) : [qualification, ...state.qualifications] }, "Qualification saved.");
  }

  function upsertCertificate(certificate: StaffCertificate) {
    if (!certificate.certificateType.trim()) {
      setMessage("Training type is required.");
      return;
    }
    const exists = state.certificates.some((item) => item.id === certificate.id);
    persist({ ...state, certificates: exists ? state.certificates.map((item) => item.id === certificate.id ? { ...certificate, updatedAt: new Date().toISOString() } : item) : [certificate, ...state.certificates] }, "Certificate saved.");
  }

  function archiveRecord(kind: "qualification" | "certificate" | "reference", id: string) {
    if (!confirm("Archive this record? It will remain in history but no longer count as active.")) return;
    if (kind === "qualification") persist({ ...state, qualifications: state.qualifications.map((item) => item.id === id ? { ...item, archivedAt: new Date().toISOString() } : item) }, "Qualification archived.");
    if (kind === "certificate") persist({ ...state, certificates: state.certificates.map((item) => item.id === id ? { ...item, archivedAt: new Date().toISOString() } : item) }, "Certificate archived.");
    if (kind === "reference") persist({ ...state, references: state.references.map((item) => item.id === id ? { ...item, archivedAt: new Date().toISOString() } : item) }, "Reference archived.");
  }

  if (!staff) {
    return <AppShell><Panel><EmptyState title="Staff profile not found" body="Return to compliance and choose an existing staff member." /></Panel></AppShell>;
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <Link className="text-sm font-bold text-purple-700" href="/compliance">Back to compliance</Link>
          <h1 className="mt-1 text-3xl font-black text-purple-950">{staff.fullName}</h1>
          <p className="mt-2 text-sm text-slate-600">Manager-only editable compliance record. Demo edits are local browser data.</p>
        </div>
        {dirty && <StatusPill tone="amber">Unsaved changes</StatusPill>}
      </div>
      {message && <p className="mb-4 rounded-xl bg-purple-50 p-3 text-sm font-bold text-purple-800">{message}</p>}
      <div className="grid gap-4">
        <Panel>
          <h2 className="text-xl font-black text-purple-950">Basic staff information</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Full name"><input className={inputClassName()} value={staff.fullName} onChange={(e) => patchStaff("fullName", e.target.value)} /></Field>
            <Field label="Preferred name"><input className={inputClassName()} value={staff.displayName} onChange={(e) => patchStaff("displayName", e.target.value)} /></Field>
            <Field label="Role"><input className={inputClassName()} value={staff.employmentRole} onChange={(e) => patchStaff("employmentRole", e.target.value)} /></Field>
            <Field label="Main qualification"><input className={inputClassName()} value={staff.mainQualificationLevel ?? ""} onChange={(e) => patchStaff("mainQualificationLevel", e.target.value || null)} /></Field>
            <Field label="Appointment/start date"><input className={inputClassName()} type="date" value={staff.appointmentDate ?? ""} onChange={(e) => patchStaff("appointmentDate", e.target.value || null)} /></Field>
            <Field label="Email address"><input className={inputClassName()} type="email" value={staff.email ?? ""} onChange={(e) => patchStaff("email", e.target.value || null)} /></Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 font-bold text-purple-950"><input type="checkbox" checked={staff.isApprentice} onChange={(e) => patchStaff("isApprentice", e.target.checked)} /> Apprentice</label>
            <label className="flex items-center gap-2 font-bold text-purple-950"><input type="checkbox" checked={staff.isCoverStaff} onChange={(e) => patchStaff("isCoverStaff", e.target.checked)} /> Cover staff</label>
          </div>
          <Field label="Notes"><textarea className={inputClassName("mt-3 min-h-20 w-full")} value={staff.notes ?? ""} onChange={(e) => patchStaff("notes", e.target.value || null)} /></Field>
          <div className="mt-4 flex gap-3"><Button onClick={saveStaff}><Save className="h-4 w-4" /> Save details</Button><Button variant="secondary" onClick={() => { setState(loadState()); setDirty(false); }}>Cancel</Button></div>
        </Panel>

        <Panel>
          <h2 className="text-xl font-black text-purple-950">Login/account status</h2>
          <p className="mt-2 text-sm text-slate-600">{staff.authUserId ? "Supabase login linked." : "No login linked. Add email, invite in Supabase Auth, then link the Auth user ID server-side."}</p>
        </Panel>

        <EditableQualificationList qualifications={qualifications} blank={blankQualification} onSave={upsertQualification} onArchive={(id) => archiveRecord("qualification", id)} />
        <EditableCertificateList certificates={certificates} blank={blankCertificate} onSave={upsertCertificate} onArchive={(id) => archiveRecord("certificate", id)} />

        <Panel>
          <h2 className="text-xl font-black text-purple-950">DBS and suitability</h2>
          <p className="mt-2 text-sm font-bold text-purple-800">Central-record completion: {central.completed}/{central.total}</p>
          {centralRecord && (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="flex items-center gap-2 font-bold text-purple-950"><input type="checkbox" checked={centralRecord.dbsRecorded} onChange={(e) => persist({ ...state, centralRecords: state.centralRecords.map((record) => record.staffId === staffId ? { ...record, dbsRecorded: e.target.checked } : record) }, "DBS status saved.")} /> DBS recorded</label>
              <label className="flex items-center gap-2 font-bold text-purple-950"><input type="checkbox" checked={centralRecord.dbsUpdateService} onChange={(e) => persist({ ...state, centralRecords: state.centralRecords.map((record) => record.staffId === staffId ? { ...record, dbsUpdateService: e.target.checked } : record) }, "DBS update service saved.")} /> Update service</label>
              <label className="flex items-center gap-2 font-bold text-purple-950"><input type="checkbox" checked={centralRecord.dbsNewCheckRequired} onChange={(e) => persist({ ...state, centralRecords: state.centralRecords.map((record) => record.staffId === staffId ? { ...record, dbsNewCheckRequired: e.target.checked } : record) }, "DBS requirement saved.")} /> New DBS required</label>
              <Field label="DBS number"><div className="flex gap-2"><input className={inputClassName()} value={showDbs ? `******${centralRecord.dbsNumberLast4 ?? ""}` : `****${centralRecord.dbsNumberLast4 ?? ""}`} readOnly /><Button variant="secondary" onClick={() => setShowDbs(!showDbs)}>{showDbs ? "Mask" : "Reveal"}</Button></div></Field>
              <Field label="Issue date"><input className={inputClassName()} type="date" value={centralRecord.dbsIssueDate ?? ""} onChange={(e) => persist({ ...state, centralRecords: state.centralRecords.map((record) => record.staffId === staffId ? { ...record, dbsIssueDate: e.target.value || null } : record) }, "DBS issue date saved.")} /></Field>
              <Field label="Last checked"><input className={inputClassName()} type="date" value={centralRecord.dbsLastCheckedAt ?? ""} onChange={(e) => persist({ ...state, centralRecords: state.centralRecords.map((record) => record.staffId === staffId ? { ...record, dbsLastCheckedAt: e.target.value || null } : record) }, "DBS checked date saved.")} /></Field>
            </div>
          )}
        </Panel>

        <Panel>
          <h2 className="text-xl font-black text-purple-950">Central-record checklist</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {centralRecord && checklist.map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-purple-100 p-3 font-bold text-purple-950">
                <span>{label}</span>
                <input type="checkbox" checked={Boolean(centralRecord[key])} onChange={(e) => persist({ ...state, centralRecords: state.centralRecords.map((record) => record.staffId === staffId ? { ...record, [key]: e.target.checked } : record) }, `${label} saved.`)} />
              </label>
            ))}
          </div>
        </Panel>

        <ReferenceList staffId={staffId} references={references} onSave={(reference) => {
          const exists = state.references.some((item) => item.id === reference.id);
          persist({ ...state, references: exists ? state.references.map((item) => item.id === reference.id ? reference : item) : [reference, ...state.references] }, "Reference saved.");
        }} onArchive={(id) => archiveRecord("reference", id)} />

        <Panel>
          <h2 className="text-xl font-black text-purple-950">Import warnings and audit</h2>
          {(state.importWarnings[staffId] ?? []).length ? state.importWarnings[staffId].map((warning) => <p key={warning} className="mt-2 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{warning}</p>) : <EmptyState title="No import warnings" body="Any uncertain source rows will appear here after import review." />}
          <p className="mt-4 text-sm text-slate-600">Created {formatDateUk(staff.createdAt)}. Last updated {formatDateUk(staff.updatedAt)}.</p>
        </Panel>
      </div>
    </AppShell>
  );
}

function EditableQualificationList({ qualifications, blank, onSave, onArchive }: { qualifications: StaffQualification[]; blank: StaffQualification; onSave: (qualification: StaffQualification) => void; onArchive: (id: string) => void }) {
  const [editing, setEditing] = useState<StaffQualification | null>(null);
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-purple-950">Qualifications</h2><Button variant="secondary" onClick={() => setEditing(blank)}><Plus className="h-4 w-4" /> Add qualification</Button></div>
      <div className="mt-4 grid gap-3">{qualifications.length ? qualifications.map((qualification) => <div key={qualification.id} className="rounded-xl border border-purple-100 p-3"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-bold text-purple-950">{qualification.qualificationName}</p><p className="text-sm text-slate-600">{qualification.qualificationLevel ?? "No level"} · {qualification.evidenceStatus}</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => setEditing(qualification)}>Edit</Button><Button variant="secondary" onClick={() => onArchive(qualification.id)}><Archive className="h-4 w-4" /> Archive</Button></div></div></div>) : <EmptyState title="No qualifications" body="Add permanent or expected qualifications here." />}</div>
      {editing && <QualificationForm qualification={editing} onCancel={() => setEditing(null)} onSave={(next) => { onSave(next); setEditing(null); }} />}
    </Panel>
  );
}

function QualificationForm({ qualification, onSave, onCancel }: { qualification: StaffQualification; onSave: (qualification: StaffQualification) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(qualification);
  return <div className="mt-4 rounded-xl bg-purple-50 p-4"><div className="grid gap-4 md:grid-cols-3"><Field label="Qualification name"><input className={inputClassName()} value={draft.qualificationName} onChange={(e) => setDraft({ ...draft, qualificationName: e.target.value })} /></Field><Field label="Level"><input className={inputClassName()} value={draft.qualificationLevel ?? ""} onChange={(e) => setDraft({ ...draft, qualificationLevel: e.target.value })} /></Field><Field label="Awarding organisation"><input className={inputClassName()} value={draft.awardingOrganisation ?? ""} onChange={(e) => setDraft({ ...draft, awardingOrganisation: e.target.value })} /></Field><Field label="Award date"><input className={inputClassName()} type="date" value={draft.awardDate ?? ""} onChange={(e) => setDraft({ ...draft, awardDate: e.target.value || null })} /></Field><Field label="Expected completion"><input className={inputClassName()} type="date" value={draft.expectedCompletionDate ?? ""} onChange={(e) => setDraft({ ...draft, expectedCompletionDate: e.target.value || null })} /></Field><Field label="Evidence status"><select className={inputClassName()} value={draft.evidenceStatus} onChange={(e) => setDraft({ ...draft, evidenceStatus: e.target.value as EvidenceStatus })}><option value="awaiting">Awaiting</option><option value="received">Received</option><option value="verified">Verified</option><option value="not_required">Not required</option></select></Field></div><div className="mt-3 flex flex-wrap gap-4"><label className="font-bold text-purple-950"><input type="checkbox" checked={draft.permanent} onChange={(e) => setDraft({ ...draft, permanent: e.target.checked })} /> Permanent</label><label className="font-bold text-purple-950"><input type="checkbox" checked={Boolean(draft.verifiedAt)} onChange={(e) => setDraft({ ...draft, verifiedAt: e.target.checked ? new Date().toISOString() : null, verifiedBy: e.target.checked ? "manager" : null })} /> Verified</label></div><Field label="Notes"><textarea className={inputClassName("mt-3 min-h-20 w-full")} value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field><div className="mt-3 flex gap-2"><Button onClick={() => onSave(draft)}><Check className="h-4 w-4" /> Save qualification</Button><Button variant="secondary" onClick={onCancel}>Cancel</Button></div></div>;
}

function EditableCertificateList({ certificates, blank, onSave, onArchive }: { certificates: StaffCertificate[]; blank: StaffCertificate; onSave: (certificate: StaffCertificate) => void; onArchive: (id: string) => void }) {
  const [editing, setEditing] = useState<StaffCertificate | null>(null);
  return <Panel><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-purple-950">Training and certificates</h2><Button variant="secondary" onClick={() => setEditing(blank)}><Plus className="h-4 w-4" /> Add certificate</Button></div><div className="mt-4 grid gap-3">{certificates.length ? certificates.map((certificate) => { const status = certificateStatus(certificate, new Date("2026-06-10T12:00:00+01:00")); return <div key={certificate.id} className="rounded-xl border border-purple-100 p-3"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-bold text-purple-950">{certificate.certificateType}</p><p className="text-sm text-slate-600">Expiry: {certificate.expiryDate ? formatDateUk(certificate.expiryDate) : "No expiry"}</p><StatusPill tone={certificateStatusTone(status)}>{certificateStatusLabel(status)}</StatusPill></div><div className="flex gap-2"><Button variant="secondary" onClick={() => setEditing(certificate)}>Edit</Button><Button variant="secondary" onClick={() => onArchive(certificate.id)}><Archive className="h-4 w-4" /> Archive</Button></div></div></div>; }) : <EmptyState title="No certificates" body="Add training and certificates here." />}</div>{editing && <CertificateForm certificate={editing} onCancel={() => setEditing(null)} onSave={(next) => { onSave(next); setEditing(null); }} />}</Panel>;
}

function CertificateForm({ certificate, onSave, onCancel }: { certificate: StaffCertificate; onSave: (certificate: StaffCertificate) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(certificate);
  const suggestedExpiry = draft.completionDate && draft.validityMonths ? format(addMonths(parseISO(draft.completionDate), draft.validityMonths), "yyyy-MM-dd") : "";
  return <div className="mt-4 rounded-xl bg-purple-50 p-4"><div className="grid gap-4 md:grid-cols-3"><Field label="Training type"><input className={inputClassName()} value={draft.certificateType} onChange={(e) => setDraft({ ...draft, certificateType: e.target.value })} /></Field><Field label="Custom title"><input className={inputClassName()} value={draft.customTitle ?? ""} onChange={(e) => setDraft({ ...draft, customTitle: e.target.value })} /></Field><Field label="Completion date"><input className={inputClassName()} type="date" value={draft.completionDate ?? ""} onChange={(e) => setDraft({ ...draft, completionDate: e.target.value || null })} /></Field><Field label="Expiry date"><input className={inputClassName()} type="date" value={draft.expiryDate ?? ""} onChange={(e) => setDraft({ ...draft, expiryDate: e.target.value || null, permanent: !e.target.value })} /></Field><Field label="Validity months"><input className={inputClassName()} type="number" value={draft.validityMonths ?? ""} onChange={(e) => setDraft({ ...draft, validityMonths: e.target.value ? Number(e.target.value) : null })} /></Field><Field label="Evidence status"><select className={inputClassName()} value={draft.evidenceStatus} onChange={(e) => setDraft({ ...draft, evidenceStatus: e.target.value as EvidenceStatus })}><option value="awaiting">Awaiting</option><option value="received">Received</option><option value="verified">Verified</option><option value="not_required">Not required</option></select></Field></div>{suggestedExpiry && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">Suggested expiry: {formatDateUk(suggestedExpiry)}. Use the expiry field to confirm it before saving.</p>}<div className="mt-3 flex flex-wrap gap-4"><label className="font-bold text-purple-950"><input type="checkbox" checked={draft.permanent} onChange={(e) => setDraft({ ...draft, permanent: e.target.checked, expiryDate: e.target.checked ? null : draft.expiryDate })} /> No expiry or permanent</label><label className="font-bold text-purple-950"><input type="checkbox" checked={Boolean(draft.verifiedAt)} onChange={(e) => setDraft({ ...draft, verifiedAt: e.target.checked ? new Date().toISOString() : null, verifiedBy: e.target.checked ? "manager" : null })} /> Verified</label></div><Field label="Notes"><textarea className={inputClassName("mt-3 min-h-20 w-full")} value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field><div className="mt-3 flex gap-2"><Button onClick={() => onSave(draft)}><Check className="h-4 w-4" /> Save certificate</Button><Button variant="secondary" onClick={onCancel}>Cancel</Button></div></div>;
}

function ReferenceList({ staffId, references, onSave, onArchive }: { staffId: string; references: StaffReferenceCheck[]; onSave: (reference: StaffReferenceCheck) => void; onArchive: (id: string) => void }) {
  const [editing, setEditing] = useState<StaffReferenceCheck | null>(null);
  const blank: StaffReferenceCheck = { id: uid("ref"), staffId, referenceType: "current_last_employer", referenceName: "", method: "written", satisfactory: null, notes: null, checkedBy: "manager", checkedAt: null, archivedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return <Panel><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-purple-950">References</h2><Button variant="secondary" onClick={() => setEditing(blank)}><Plus className="h-4 w-4" /> Add reference</Button></div><div className="mt-4 grid gap-3">{references.length ? references.map((reference) => <div key={reference.id} className="rounded-xl border border-purple-100 p-3"><p className="font-bold text-purple-950">{reference.referenceName || reference.referenceType}</p><p className="text-sm text-slate-600">{reference.method ?? "Method not recorded"} · {reference.checkedAt ? formatDateUk(reference.checkedAt) : "No date"}</p><div className="mt-2 flex gap-2"><Button variant="secondary" onClick={() => setEditing(reference)}>Edit</Button><Button variant="secondary" onClick={() => onArchive(reference.id)}>Archive</Button></div></div>) : <EmptyState title="No references" body="Add written, telephone or alternative references." />}</div>{editing && <ReferenceForm reference={editing} onCancel={() => setEditing(null)} onSave={(next) => { onSave(next); setEditing(null); }} />}</Panel>;
}

function ReferenceForm({ reference, onSave, onCancel }: { reference: StaffReferenceCheck; onSave: (reference: StaffReferenceCheck) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(reference);
  return <div className="mt-4 rounded-xl bg-purple-50 p-4"><div className="grid gap-4 md:grid-cols-3"><Field label="Reference type"><select className={inputClassName()} value={draft.referenceType} onChange={(e) => setDraft({ ...draft, referenceType: e.target.value as StaffReferenceCheck["referenceType"] })}><option value="current_last_employer">Current or last employer</option><option value="previous_employer">Previous employer</option><option value="alternative">Alternative</option></select></Field><Field label="Referee or organisation"><input className={inputClassName()} value={draft.referenceName ?? ""} onChange={(e) => setDraft({ ...draft, referenceName: e.target.value })} /></Field><Field label="Method"><select className={inputClassName()} value={draft.method ?? "written"} onChange={(e) => setDraft({ ...draft, method: e.target.value as StaffReferenceCheck["method"] })}><option value="written">Written</option><option value="telephone">Telephone</option><option value="email">Email</option></select></Field><Field label="Date checked"><input className={inputClassName()} type="date" value={draft.checkedAt ?? ""} onChange={(e) => setDraft({ ...draft, checkedAt: e.target.value || null })} /></Field><label className="flex items-center gap-2 pt-6 font-bold text-purple-950"><input type="checkbox" checked={draft.satisfactory === true} onChange={(e) => setDraft({ ...draft, satisfactory: e.target.checked })} /> Satisfactory</label></div><Field label="Notes"><textarea className={inputClassName("mt-3 min-h-20 w-full")} value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field><div className="mt-3 flex gap-2"><Button onClick={() => onSave(draft)}>Save reference</Button><Button variant="secondary" onClick={onCancel}>Cancel</Button></div></div>;
}
