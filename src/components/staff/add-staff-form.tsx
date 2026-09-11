import Link from "next/link";
import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { Field, Panel, inputClassName } from "@/components/ui/primitives";
import { createCommercialStaffProfileAction, createStaffProfileAction } from "@/lib/staff/actions";

export function AddStaffForm({ commercial = false }: { commercial?: boolean }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-purple-950">Add staff member</h2>
          <p className="mt-1 text-sm text-slate-600">
            Create their staff record first. Clocking-in access, login and pay details can be set up from their record.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200"
          href="/staff"
        >
          Cancel
        </Link>
      </div>
      <ProductionActionForm
        action={commercial ? createCommercialStaffProfileAction : createStaffProfileAction}
        className="mt-5"
        submitLabel="Add staff member"
      >
        <fieldset>
          <legend className="text-base font-black text-purple-950">Employment details</legend>
          <p className="mt-1 text-sm text-slate-600">Use the person&apos;s legal name for employment and compliance records.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Full legal name">
              <input className={inputClassName()} name="fullName" autoComplete="name" required />
            </Field>
            <Field label="Name shown on Staff Clock">
              <input className={inputClassName()} name="displayName" aria-describedby="staff-clock-name-hint" />
            </Field>
            <p id="staff-clock-name-hint" className="-mt-2 text-xs text-slate-500 md:col-start-2">Leave blank to use their legal name.</p>
            <Field label="Role">
              <input className={inputClassName()} name="employmentRole" required />
            </Field>
            <Field label="Main qualification">
              <input className={inputClassName()} name="mainQualificationLevel" />
            </Field>
            <Field label="Proposed start date">
              <input className={inputClassName()} name="appointmentDate" type="date" />
            </Field>
          </div>
        </fieldset>
        <fieldset className="mt-6 rounded-lg border border-purple-100 bg-purple-50/60 p-4">
          <legend className="px-1 text-base font-black text-purple-950">Operational status</legend>
          <label className="flex min-h-11 items-start gap-3 font-bold text-purple-950">
            <input className="mt-1 h-5 w-5" name="active" type="checkbox" defaultChecked />
            <span>Include in active staff records<span className="mt-1 block text-sm font-normal text-slate-600">Recruitment checks and start authorisation still determine whether this person can work.</span></span>
          </label>
        </fieldset>
      </ProductionActionForm>
    </Panel>
  );
}
