"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { StaffDirectoryRow } from "@/lib/payroll/types";
import { EmptyState, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";

export type StaffDirectoryFilter = "active" | "needs-setup" | "inactive";

export function highestPrioritySetupWarning(person: StaffDirectoryRow): string {
  if (!person.active) return "No setup action needed";
  if (person.kioskStatus === "PIN setup needed") return "Set a Staff Clock PIN";
  if (person.kioskStatus === "Disabled") return "Enable Staff Clock";
  if (person.loginStatus === "Login not linked") return "Finish staff login setup";
  if (!person.hasQualification) return "Add qualification";
  if (!person.hasCurrentPayArrangement) return "Add pay details";
  return "Setup complete";
}

function needsSetup(person: StaffDirectoryRow): boolean {
  return person.active && highestPrioritySetupWarning(person) !== "Setup complete";
}

export function ProductionStaffScreen({
  staff,
  initialFilter = "active",
}: {
  staff: StaffDirectoryRow[];
  initialFilter?: StaffDirectoryFilter;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StaffDirectoryFilter>(initialFilter);
  const filtered = useMemo(() => staff.filter((person) =>
    (filter === "active" ? person.active : filter === "inactive" ? !person.active : needsSetup(person)) &&
    `${person.fullName} ${person.displayName} ${person.employmentRole}`.toLowerCase().includes(query.trim().toLowerCase())
  ), [filter, query, staff]);

  const filters: Array<{ id: StaffDirectoryFilter; label: string }> = [
    { id: "active", label: "Active" },
    { id: "needs-setup", label: "Needs setup" },
    { id: "inactive", label: "Inactive" },
  ];

  return (
    <Panel>
      <div className="grid gap-4 md:grid-cols-[minmax(16rem,1fr)_auto] md:items-end">
        <label className="grid gap-1 text-sm font-semibold text-purple-950">
          <span>Search staff</span>
          <input
            className={inputClassName()}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or role"
          />
        </label>
        <div>
          <p className="mb-1 text-sm font-semibold text-purple-950">Show</p>
          <div className="inline-flex min-h-11 overflow-hidden rounded-lg border border-purple-200" aria-label="Filter staff records">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`min-h-11 px-4 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-purple-700 ${
                  filter === item.id
                    ? "bg-purple-700 text-white"
                    : "bg-white text-purple-900 hover:bg-purple-50"
                }`}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-purple-100">
        {filtered.map((person) => {
          const warning = highestPrioritySetupWarning(person);
          return (
            <div
              key={person.id}
              className="grid gap-3 border-b border-purple-100 py-4 lg:grid-cols-[minmax(12rem,1.3fr)_minmax(9rem,1fr)_auto_auto_auto] lg:items-center"
            >
              <div>
                <h2 className="font-black text-purple-950">{person.fullName}</h2>
                {person.displayName !== person.fullName ? (
                  <p className="text-xs text-slate-500">Staff Clock: {person.displayName}</p>
                ) : null}
              </div>
              <p className="text-sm text-slate-700">{person.employmentRole}</p>
              <StatusPill tone={person.active ? "green" : "grey"}>{person.active ? "Active" : "Inactive"}</StatusPill>
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">Clocking in</p>
                <p className="mt-1 text-sm font-semibold text-slate-700">{person.kioskStatus}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 lg:justify-end">
                <StatusPill tone={warning === "Setup complete" || warning === "No setup action needed" ? "green" : "amber"}>
                  {warning}
                </StatusPill>
                <Link
                  className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50"
                  href={`/compliance/staff/${person.id}`}
                >
                  Open record
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {!filtered.length ? (
        <div className="mt-5">
          <EmptyState title="No staff found" body="Try another name or filter." />
        </div>
      ) : null}
    </Panel>
  );
}
