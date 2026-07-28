import Link from "next/link";
import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { Field, Panel, inputClassName } from "@/components/ui/primitives";
import { createStaffProfileAction } from "@/lib/staff/actions";

export function AddStaffForm() {
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
        action={createStaffProfileAction}
        className="mt-5"
        submitLabel="Add staff member"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Full legal name">
            <input className={inputClassName()} name="fullName" required />
          </Field>
          <Field label="Name shown on Staff Clock">
            <input className={inputClassName()} name="displayName" />
          </Field>
          <Field label="Role">
            <input className={inputClassName()} name="employmentRole" required />
          </Field>
          <Field label="Qualification">
            <input className={inputClassName()} name="mainQualificationLevel" />
          </Field>
          <Field label="Start date">
            <input className={inputClassName()} name="appointmentDate" type="date" />
          </Field>
        </div>
        <label className="mt-4 flex min-h-11 items-center gap-2 font-bold text-purple-950">
          <input name="active" type="checkbox" defaultChecked />
          Active
        </label>
      </ProductionActionForm>
    </Panel>
  );
}
