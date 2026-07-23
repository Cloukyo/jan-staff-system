"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { closePayArrangementAction, savePayArrangementAction } from "@/lib/payroll/actions";
import {
  createStaffProfileAction,
  deactivateStaffProfileAction,
  reactivateStaffProfileAction,
} from "@/lib/staff/actions";
import type { ProductionStaffRow } from "@/lib/payroll/types";
import { PayrollActionForm } from "@/components/payroll/payroll-action-form";
import { Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatDateUk, formatMoney, isoDateInLondon } from "@/lib/dates/format";

export function ProductionStaffScreen({
  staff,
  showStaffLifecycleControls = false,
  currentStaffId,
}: {
  staff: ProductionStaffRow[];
  showStaffLifecycleControls?: boolean;
  currentStaffId?: string;
}) {
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const filtered = useMemo(() => staff.filter((person) =>
    (includeInactive || person.active) &&
    `${person.fullName} ${person.employmentRole}`.toLowerCase().includes(query.toLowerCase())
  ), [includeInactive, query, staff]);
  return (
    <div className="grid gap-5">
      {showStaffLifecycleControls && (
        <Panel>
          <h2 className="text-xl font-black text-purple-950">Add staff member</h2>
          <p className="mt-2 text-sm text-slate-600">
            Create the staff profile here, then complete account, kiosk, pay and compliance setup as needed.
          </p>
          <ProductionActionForm action={createStaffProfileAction} className="mt-4">
            <div className="grid gap-4 md:grid-cols-5">
              <Field label="Full name"><input className={inputClassName()} name="fullName" required /></Field>
              <Field label="Preferred name"><input className={inputClassName()} name="displayName" /></Field>
              <Field label="Role"><input className={inputClassName()} name="employmentRole" required /></Field>
              <Field label="Qualification"><input className={inputClassName()} name="mainQualificationLevel" /></Field>
              <Field label="Start date"><input className={inputClassName()} name="appointmentDate" type="date" /></Field>
            </div>
            <label className="mt-3 flex min-h-11 items-center gap-2 font-bold text-purple-950">
              <input name="active" type="checkbox" defaultChecked /> Active
            </label>
          </ProductionActionForm>
        </Panel>
      )}
      <Panel>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input className={inputClassName()} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff" />
          <label className="flex min-h-11 items-center gap-2 font-bold text-purple-950"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} /> Include inactive staff</label>
        </div>
      </Panel>
      {filtered.map((person) => (
        <StaffPayCard
          key={person.id}
          person={person}
          showStaffLifecycleControls={showStaffLifecycleControls}
          currentStaffId={currentStaffId}
        />
      ))}
    </div>
  );
}

function StaffPayCard({
  person,
  showStaffLifecycleControls,
  currentStaffId,
}: {
  person: ProductionStaffRow;
  showStaffLifecycleControls: boolean;
  currentStaffId?: string;
}) {
  const [showEditor, setShowEditor] = useState(false);
  const [confirmingDeactivation, setConfirmingDeactivation] = useState(false);
  const today = isoDateInLondon();
  const current = person.payArrangements.find((item) => item.isActive && item.effectiveFrom <= today && (!item.effectiveTo || item.effectiveTo >= today));
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-purple-950">{person.fullName}</h2>
          <p className="text-sm text-slate-600">{person.employmentRole}{person.mainQualificationLevel ? ` | ${person.mainQualificationLevel}` : ""}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusPill tone={person.active ? "green" : "grey"}>{person.active ? "Active" : "Inactive"}</StatusPill>
            <StatusPill tone={person.loginStatus === "Active login" ? "green" : "grey"}>{person.loginStatus}</StatusPill>
            <StatusPill tone={person.kioskStatus === "Enabled" ? "green" : "amber"}>{person.kioskStatus}</StatusPill>
            <StatusPill tone={current ? "green" : "red"}>{current ? `${current.payType} pay arrangement` : "No active pay arrangement"}</StatusPill>
            {person.isManager && <StatusPill tone="purple">Manager profile</StatusPill>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200" href={`/compliance/staff/${person.id}`}>Staff record</Link>
          <button className="min-h-11 rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" type="button" onClick={() => setShowEditor((value) => !value)}>{showEditor ? "Close pay editor" : "Manage pay"}</button>
          {showStaffLifecycleControls && person.active && person.id !== currentStaffId && (
            <button
              className="min-h-11 rounded-xl bg-red-700 px-4 text-sm font-bold text-white"
              type="button"
              onClick={() => setConfirmingDeactivation(true)}
            >
              Deactivate staff member
            </button>
          )}
          {showStaffLifecycleControls && !person.active && (
            <div>
              <ProductionActionForm action={reactivateStaffProfileAction} submitLabel="Reactivate staff member">
                <input type="hidden" name="staffId" value={person.id} />
              </ProductionActionForm>
              <p className="mt-2 text-xs text-slate-600">Login and kiosk access will remain disabled.</p>
            </div>
          )}
        </div>
      </div>
      {confirmingDeactivation && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
          <p className="font-black text-red-950">Confirm deactivation</p>
          <p className="mt-2 text-sm text-red-900">
            The person will be removed from active staff, rota and kiosk lists. Login and kiosk clocking will be disabled. Attendance, rota, pay, audit and compliance history remains preserved.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ProductionActionForm action={deactivateStaffProfileAction} submitLabel="Confirm deactivation" submitVariant="danger">
              <input type="hidden" name="staffId" value={person.id} />
            </ProductionActionForm>
            <button
              className="min-h-11 rounded-xl bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200"
              type="button"
              onClick={() => setConfirmingDeactivation(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {showEditor && (
        <div className="mt-5 grid gap-5 border-t border-purple-100 pt-5">
          <div>
            <h3 className="font-black text-purple-950">Pay history</h3>
            {!person.payArrangements.length && <p className="mt-2 text-sm text-amber-700">No pay arrangements have been imported or entered.</p>}
            {person.payArrangements.map((item) => (
              <div key={item.id} className="mt-3 rounded-lg border border-purple-100 p-3">
                <p className="font-bold text-purple-950">{item.payType === "hourly" ? `${formatMoney(item.hourlyRate === null ? null : Math.round(item.hourlyRate * 100))} per hour` : item.annualSalary !== null ? `${formatMoney(Math.round(item.annualSalary * 100))} annual salary basis` : `${formatMoney(item.monthlySalary === null ? null : Math.round(item.monthlySalary * 100))} monthly salary basis`}</p>
                <p className="text-sm text-slate-600">{formatDateUk(item.effectiveFrom)} to {item.effectiveTo ? formatDateUk(item.effectiveTo) : "ongoing"} | {item.contractedWeeklyHours === null ? item.hoursBasis.replaceAll("_", " ") : `${item.contractedWeeklyHours} contracted hours weekly`}</p>
                <p className="mt-1 text-xs text-slate-500">Created by {item.createdByName ?? "manager"} on {formatDateUk(item.createdAt.slice(0, 10))}</p>
                {!item.effectiveTo && <PayrollActionForm action={closePayArrangementAction} submitLabel="End arrangement" className="mt-2"><input type="hidden" name="arrangementId" value={item.id} /><Field label="Effective end date"><input className={inputClassName()} type="date" name="effectiveTo" required /></Field></PayrollActionForm>}
              </div>
            ))}
          </div>
          <PayrollActionForm action={savePayArrangementAction} submitLabel="Add pay arrangement">
            <input type="hidden" name="staffId" value={person.id} />
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Pay type"><select className={inputClassName()} name="payType"><option value="hourly">Hourly</option><option value="salaried">Salaried</option></select></Field>
              <Field label="Hourly rate"><input className={inputClassName()} name="hourlyRate" type="number" min="0" step="0.01" /></Field>
              <Field label="Annual salary"><input className={inputClassName()} name="annualSalary" type="number" min="0" step="0.01" /></Field>
              <Field label="Monthly salary"><input className={inputClassName()} name="monthlySalary" type="number" min="0" step="0.01" /></Field>
              <Field label="Contracted weekly hours"><input className={inputClassName()} name="contractedWeeklyHours" type="number" min="0" max="80" step="0.25" /></Field>
              <Field label="Hours basis"><select className={inputClassName()} name="hoursBasis" defaultValue="contracted"><option value="contracted">Contracted hours</option><option value="variable_hours">Variable hours</option><option value="casual">Casual</option><option value="zero_hours">Zero hours</option><option value="salaried_untracked">Salaried, hours not tracked</option></select></Field>
              <Field label="Standard daily hours"><input className={inputClassName()} name="standardDailyHours" type="number" min="0" max="24" step="0.25" /></Field>
              <Field label="Overtime multiplier"><input className={inputClassName()} name="overtimeMultiplier" type="number" min="1" max="5" step="0.01" defaultValue="1" /></Field>
              <Field label="Effective from"><input className={inputClassName()} name="effectiveFrom" type="date" required /></Field>
              <Field label="Effective to"><input className={inputClassName()} name="effectiveTo" type="date" /></Field>
              <Field label="Manager notes"><input className={inputClassName()} name="managerNotes" /></Field>
            </div>
          </PayrollActionForm>
        </div>
      )}
    </Panel>
  );
}
