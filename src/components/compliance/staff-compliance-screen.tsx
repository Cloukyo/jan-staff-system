"use client";

import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { EmptyState, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
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

export function StaffComplianceScreen() {
  const [state, setState] = useState<DemoComplianceState>(() => loadDemoCompliance());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
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

  function quickSave(person: StaffProfile, field: "employmentRole" | "mainQualificationLevel", value: string) {
    const next = {
      ...state,
      staff: state.staff.map((item) => (item.id === person.id ? { ...item, [field]: field === "mainQualificationLevel" && value === "" ? null : value, updatedAt: new Date().toISOString() } : item)),
    };
    persist(next, "Quick edit saved in demo mode.");
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
                            <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-purple-900 shadow-sm ring-1 ring-purple-200 hover:bg-purple-50" href={`/compliance/staff/${person.id}`}>View</Link>
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
