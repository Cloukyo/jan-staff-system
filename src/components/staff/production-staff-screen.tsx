"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ProductionActionForm } from "@/components/compliance/production-action-form";
import type { StaffDirectoryRow } from "@/lib/payroll/types";
import {
  deactivateStaffProfileAction,
  reactivateStaffProfileAction,
} from "@/lib/staff/actions";
import type { StaffDirectoryFilter } from "@/lib/staff/directory";
import { EmptyState, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";

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

export function filterStaffDirectoryRows(
  staff: StaffDirectoryRow[],
  filter: StaffDirectoryFilter,
  query = "",
): StaffDirectoryRow[] {
  const normalisedQuery = query.trim().toLowerCase();
  return staff.filter((person) => {
    const matchesFilter = filter === "active"
      ? person.active
      : filter === "inactive"
        ? !person.active
        : filter === "needs-checks"
          ? person.active && person.hasComplianceIssues
          : needsSetup(person);
    return matchesFilter
      && `${person.fullName} ${person.displayName} ${person.employmentRole}`
        .toLowerCase()
        .includes(normalisedQuery);
  });
}

export function ProductionStaffScreen({
  staff,
  initialFilter = "active",
  showStaffLifecycleControls = false,
  currentStaffId,
}: {
  staff: StaffDirectoryRow[];
  initialFilter?: StaffDirectoryFilter;
  showStaffLifecycleControls?: boolean;
  currentStaffId?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StaffDirectoryFilter>(initialFilter);
  const [confirmingStaffId, setConfirmingStaffId] = useState<string | null>(null);
  const filtered = useMemo(
    () => filterStaffDirectoryRows(staff, filter, query),
    [filter, query, staff],
  );

  const filters: Array<{ id: StaffDirectoryFilter; label: string }> = [
    { id: "active", label: "Active" },
    { id: "needs-setup", label: "Needs setup" },
    { id: "needs-checks", label: "Needs checks" },
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
          <div className="inline-flex min-h-11 flex-wrap overflow-hidden rounded-lg border border-purple-200" aria-label="Filter staff records">
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
                {showStaffLifecycleControls && person.active && person.id !== currentStaffId ? (
                  <button
                    className="min-h-11 rounded-lg bg-red-700 px-4 text-sm font-bold text-white hover:bg-red-800"
                    type="button"
                    onClick={() => setConfirmingStaffId(person.id)}
                  >
                    Deactivate staff member
                  </button>
                ) : null}
                {showStaffLifecycleControls && !person.active ? (
                  <div>
                    <ProductionActionForm action={reactivateStaffProfileAction} submitLabel="Reactivate staff member">
                      <input type="hidden" name="staffId" value={person.id} />
                    </ProductionActionForm>
                    <p className="mt-2 max-w-48 text-xs text-slate-600">Login and kiosk access will remain disabled.</p>
                  </div>
                ) : null}
              </div>
              {confirmingStaffId === person.id ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 lg:col-span-5" role="alert">
                  <p className="font-black text-red-950">Confirm deactivation</p>
                  <p className="mt-2 text-sm text-red-900">
                    The person will be removed from active staff, rota and kiosk lists. Login and kiosk clocking will be disabled. Attendance, rota, pay, audit and compliance history remains preserved.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ProductionActionForm action={deactivateStaffProfileAction} submitLabel="Confirm deactivation" submitVariant="danger">
                      <input type="hidden" name="staffId" value={person.id} />
                    </ProductionActionForm>
                    <button
                      className="min-h-11 rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200"
                      type="button"
                      onClick={() => setConfirmingStaffId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
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
