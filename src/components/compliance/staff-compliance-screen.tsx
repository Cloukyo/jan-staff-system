"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Save, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button, EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import {
  centralRecordCompletion,
  certificateStatus,
  certificateStatusLabel,
  certificateStatusTone,
  complianceDashboardCounts,
  findCertificate,
  overallComplianceIndicator,
} from "@/lib/calculations/compliance";
import { createDemoComplianceState, demoComplianceStorageKey, type DemoComplianceState } from "@/lib/compliance/demo-data";
import { formatDateUk } from "@/lib/dates/format";
import type { CertificateStatus, StaffProfile } from "@/types";

function loadDemoCompliance(): DemoComplianceState {
  if (typeof window === "undefined") return createDemoComplianceState();
  const saved = window.localStorage.getItem(demoComplianceStorageKey);
  if (!saved) return createDemoComplianceState();
  try {
    return { ...createDemoComplianceState(), ...JSON.parse(saved) };
  } catch {
    return createDemoComplianceState();
  }
}

function saveDemoCompliance(state: DemoComplianceState) {
  window.localStorage.setItem(demoComplianceStorageKey, JSON.stringify(state));
}

function newStaffId(fullName: string): string {
  return `staff-${fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function StaffComplianceScreen() {
  const [state, setState] = useState<DemoComplianceState>(() => loadDemoCompliance());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [newStaff, setNewStaff] = useState({ fullName: "", employmentRole: "", mainQualificationLevel: "", appointmentDate: "", active: true });
  const today = new Date("2026-06-10T12:00:00+01:00");

  function persist(next: DemoComplianceState, success: string) {
    setState(next);
    saveDemoCompliance(next);
    setMessage(success);
  }

  const counts = complianceDashboardCounts(state.staff, state.certificates, state.centralRecords, today);
  const filtered = state.staff.filter((person) => {
    const firstAid = findCertificate(state.certificates, person.id, ["first aid"]);
    const safeguarding = findCertificate(state.certificates, person.id, ["safeguarding"]);
    const statuses = [firstAid && certificateStatus(firstAid, today), safeguarding && certificateStatus(safeguarding, today)].filter(Boolean) as CertificateStatus[];
    const central = centralRecordCompletion(state.centralRecords.find((record) => record.staffId === person.id));
    const matchesQuery = `${person.fullName} ${person.employmentRole} ${person.mainQualificationLevel ?? ""}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "expired" && statuses.includes("expired")) ||
      (filter === "expiring" && statuses.some((status) => status.startsWith("expiring"))) ||
      (filter === "missing_evidence" && state.certificates.some((certificate) => certificate.staffId === person.id && certificate.evidenceStatus !== "verified")) ||
      (filter === "incomplete" && central.percent < 100) ||
      (filter === "inactive" && !person.active) ||
      (filter === "active" && person.active);
    return matchesQuery && matchesFilter;
  });

  function quickSave(person: StaffProfile, field: "employmentRole" | "mainQualificationLevel" | "active", value: string | boolean) {
    const next = {
      ...state,
      staff: state.staff.map((item) => (item.id === person.id ? { ...item, [field]: field === "mainQualificationLevel" && value === "" ? null : value, updatedAt: new Date().toISOString() } : item)),
    };
    persist(next, "Quick edit saved in demo mode.");
  }

  function addStaff() {
    if (!newStaff.fullName.trim() || !newStaff.employmentRole.trim()) {
      setMessage("Full name and role are required.");
      return;
    }
    const id = newStaffId(newStaff.fullName);
    if (state.staff.some((person) => person.id === id)) {
      setMessage("A staff profile with this generated ID already exists.");
      return;
    }
    const createdAt = new Date().toISOString();
    const profile: StaffProfile = {
      id,
      fullName: newStaff.fullName.trim(),
      displayName: newStaff.fullName.trim().split(" ")[0],
      employmentRole: newStaff.employmentRole.trim(),
      mainQualificationLevel: newStaff.mainQualificationLevel.trim() || null,
      isApprentice: false,
      isCoverStaff: false,
      appointmentDate: newStaff.appointmentDate || null,
      active: newStaff.active,
      authUserId: null,
      email: null,
      notes: null,
      createdAt,
      updatedAt: createdAt,
    };
    persist({ ...state, staff: [profile, ...state.staff] }, "Staff profile added in demo mode. Open View to complete the record.");
    setAdding(false);
    setNewStaff({ fullName: "", employmentRole: "", mainQualificationLevel: "", appointmentDate: "", active: true });
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-bold text-purple-700">Manager only</p>
          <h1 className="mt-1 text-3xl font-black text-purple-950">Staff Compliance</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Editable central-record, qualification and certificate tracking. Local demo edits are stored in this browser; configured production saves use Supabase manager actions.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add staff member</Button>
      </div>
      <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">Demo mode: these compliance rows are non-sensitive sample records. Do not enter real DBS or medical information here.</p>
      {message && <p className="mb-4 rounded-xl bg-purple-50 p-3 text-sm font-bold text-purple-800">{message}</p>}
      {(
        <>
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
            ].map(([label, value, tone]) => (
              <Panel key={label as string}>
                <p className="text-sm font-bold text-slate-500">{label}</p>
                <p className="mt-2 text-3xl font-black text-purple-950">{value}</p>
                <StatusPill tone={tone as "purple" | "red" | "amber"}>Manager alert</StatusPill>
              </Panel>
            ))}
          </div>
          {adding && (
            <Panel className="mt-4">
              <h2 className="text-xl font-black text-purple-950">Add staff profile</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-5">
                <Field label="Full name"><input className={inputClassName()} value={newStaff.fullName} onChange={(event) => setNewStaff({ ...newStaff, fullName: event.target.value })} /></Field>
                <Field label="Role"><input className={inputClassName()} value={newStaff.employmentRole} onChange={(event) => setNewStaff({ ...newStaff, employmentRole: event.target.value })} /></Field>
                <Field label="Qualification"><input className={inputClassName()} value={newStaff.mainQualificationLevel} onChange={(event) => setNewStaff({ ...newStaff, mainQualificationLevel: event.target.value })} /></Field>
                <Field label="Start date"><input className={inputClassName()} type="date" value={newStaff.appointmentDate} onChange={(event) => setNewStaff({ ...newStaff, appointmentDate: event.target.value })} /></Field>
                <label className="flex items-center gap-3 pt-6 text-sm font-bold text-purple-950"><input type="checkbox" checked={newStaff.active} onChange={(event) => setNewStaff({ ...newStaff, active: event.target.checked })} /> Active</label>
              </div>
              <div className="mt-4 flex gap-3"><Button onClick={addStaff}><Save className="h-4 w-4" /> Save</Button><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button></div>
            </Panel>
          )}
          <Panel className="mt-4">
            <div className="grid gap-3 md:grid-cols-[1fr_220px]">
              <label className="relative">
                <Search className="absolute left-3 top-3 h-5 w-5 text-purple-400" />
                <input className={inputClassName("w-full pl-10")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff compliance" />
              </label>
              <select className={inputClassName()} value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">All records</option>
                <option value="active">Active staff</option>
                <option value="inactive">Inactive staff</option>
                <option value="expired">Expired</option>
                <option value="expiring">Expiring soon</option>
                <option value="missing_evidence">Missing evidence</option>
                <option value="incomplete">Incomplete central record</option>
              </select>
            </div>
            {filtered.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-left text-sm">
                  <thead><tr>{["Staff", "Role", "Qualification", "First aid", "Safeguarding", "DBS", "Central", "Next expiry", "Overall", "Actions"].map((header) => <th key={header} className="border-b border-purple-100 bg-purple-50 px-3 py-3 font-black text-purple-950 first:rounded-l-xl last:rounded-r-xl">{header}</th>)}</tr></thead>
                  <tbody>
                    {filtered.map((person) => {
                      const firstAid = findCertificate(state.certificates, person.id, ["first aid"]);
                      const safeguarding = findCertificate(state.certificates, person.id, ["safeguarding"]);
                      const firstAidStatus = firstAid ? certificateStatus(firstAid, today) : "awaiting_evidence";
                      const safeguardingStatus = safeguarding ? certificateStatus(safeguarding, today) : "awaiting_evidence";
                      const central = centralRecordCompletion(state.centralRecords.find((record) => record.staffId === person.id));
                      const nextExpiry = [firstAid?.expiryDate, safeguarding?.expiryDate].filter(Boolean).sort()[0];
                      const overall = overallComplianceIndicator({ firstAidStatus, safeguardingStatus, centralRecordPercent: central.percent });
                      return (
                        <tr key={person.id}>
                          <td className="border-b border-purple-50 px-3 py-3 font-bold text-purple-950">{person.fullName}</td>
                          <td className="border-b border-purple-50 px-3 py-3"><input className={inputClassName("w-44")} defaultValue={person.employmentRole} onBlur={(event) => event.target.value !== person.employmentRole && quickSave(person, "employmentRole", event.target.value)} /></td>
                          <td className="border-b border-purple-50 px-3 py-3"><input className={inputClassName("w-32")} defaultValue={person.mainQualificationLevel ?? ""} onBlur={(event) => event.target.value !== (person.mainQualificationLevel ?? "") && quickSave(person, "mainQualificationLevel", event.target.value)} /></td>
                          <td className="border-b border-purple-50 px-3 py-3"><StatusPill tone={certificateStatusTone(firstAidStatus)}>{certificateStatusLabel(firstAidStatus)}</StatusPill></td>
                          <td className="border-b border-purple-50 px-3 py-3"><StatusPill tone={certificateStatusTone(safeguardingStatus)}>{certificateStatusLabel(safeguardingStatus)}</StatusPill></td>
                          <td className="border-b border-purple-50 px-3 py-3">{state.centralRecords.find((record) => record.staffId === person.id)?.dbsRecorded ? "Recorded" : "Missing"}</td>
                          <td className="border-b border-purple-50 px-3 py-3">{central.completed}/{central.total}</td>
                          <td className="border-b border-purple-50 px-3 py-3">{nextExpiry ? formatDateUk(nextExpiry) : "No expiry"}</td>
                          <td className="border-b border-purple-50 px-3 py-3"><StatusPill tone={overall === "urgent" ? "red" : overall === "complete" ? "green" : "amber"}>{overall}</StatusPill></td>
                          <td className="border-b border-purple-50 px-3 py-3">
                            <div className="flex gap-2">
                              <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-purple-900 shadow-sm ring-1 ring-purple-200 hover:bg-purple-50" href={`/compliance/staff/${person.id}`}>View</Link>
                              <Button variant="secondary" onClick={() => quickSave(person, "active", !person.active)}>{person.active ? "Deactivate" : "Activate"}</Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No matching records" body="Change the filters to see more staff." />}
          </Panel>
        </>
      )}
    </AppShell>
  );
}
