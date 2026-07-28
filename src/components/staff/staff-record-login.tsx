"use client";

import { StaffAccountControl } from "@/components/accounts/production-accounts";
import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { Field, Panel, inputClassName } from "@/components/ui/primitives";
import {
  prepareStaffAccountAction,
  type ProductionAccountRow,
} from "@/lib/accounts/server";

export function StaffRecordLogin({
  account,
  staffId,
  fullName,
  email,
  adminConfigured,
}: {
  account: ProductionAccountRow | null;
  staffId: string;
  fullName: string;
  email: string | null;
  adminConfigured: boolean;
}) {
  if (account) {
    return (
      <StaffAccountControl
        account={account}
        adminConfigured={adminConfigured}
      />
    );
  }

  return (
    <div className="grid gap-4">
      {!adminConfigured && (
        <Panel className="border-amber-200 bg-amber-50">
          <p className="font-bold text-amber-900">
            Invitations and login linking are unavailable until server administration is configured.
          </p>
        </Panel>
      )}
      <Panel>
        <h2 className="text-xl font-black text-purple-950">Set up staff login</h2>
        <p className="mt-2 text-sm text-slate-600">
          Prepare app login access for {fullName}. This does not create another staff record.
        </p>
        <ProductionActionForm action={prepareStaffAccountAction} submitLabel="Prepare staff login">
          <input type="hidden" name="staffId" value={staffId} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Email">
              <input
                className={inputClassName()}
                defaultValue={email ?? ""}
                name="email"
                type="email"
                required
              />
            </Field>
            <Field label="Access level">
              <select className={inputClassName()} name="role" defaultValue="staff">
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
            </Field>
          </div>
        </ProductionActionForm>
      </Panel>
    </div>
  );
}
