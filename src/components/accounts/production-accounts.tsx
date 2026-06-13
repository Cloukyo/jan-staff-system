"use client";

import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import {
  deactivateStaffAccountAction,
  inviteStaffAccountAction,
  linkExistingAuthUserAction,
  prepareStaffAccountAction,
  reactivateStaffAccountAction,
  updateStaffAccountRoleAction,
} from "@/lib/accounts/server";
import type { ProductionAccountRow, ProductionAccountStaffOption } from "@/lib/accounts/server";

export function ProductionAccountsScreen({ accounts, staff, adminConfigured }: { accounts: ProductionAccountRow[]; staff: ProductionAccountStaffOption[]; adminConfigured: boolean }) {
  const available = staff.filter((person) => !accounts.some((account) => account.staffId === person.id));
  return (
    <div className="grid gap-5">
      <div>
        <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">Accounts</h1>
        <p className="mt-2 text-slate-600">Grant login access to an existing canonical staff profile. Staff records are never duplicated here.</p>
      </div>
      {!adminConfigured && <Panel className="border-amber-200 bg-amber-50"><p className="font-bold text-amber-900">Supabase server administration is not configured. Account records can be prepared, but invitations and Auth linking are unavailable until the server-only key is added to the deployment.</p></Panel>}
      <Panel>
        <h2 className="text-xl font-black text-purple-950">Prepare account access</h2>
        {available.length ? (
          <ProductionActionForm action={prepareStaffAccountAction} submitLabel="Prepare account">
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="Staff profile"><select className={inputClassName()} name="staffId" required><option value="">Choose staff</option>{available.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></Field>
              <Field label="Email"><input className={inputClassName()} name="email" type="email" required /></Field>
              <Field label="Role"><select className={inputClassName()} name="role"><option value="staff">Staff</option><option value="manager">Manager</option></select></Field>
            </div>
          </ProductionActionForm>
        ) : <EmptyState title="Every staff profile has an account record" body="Manage existing access below." />}
      </Panel>
      <div className="grid gap-4">
        {accounts.map((account) => <AccountCard key={account.id} account={account} adminConfigured={adminConfigured} />)}
      </div>
    </div>
  );
}

function AccountCard({ account, adminConfigured }: { account: ProductionAccountRow; adminConfigured: boolean }) {
  const state = !account.active ? "Disabled login" : account.authUserId ? `Active ${account.role} login` : "Invitation prepared";
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-purple-950">{account.fullName}</h2>
          <p className="text-sm text-slate-600">{account.email}</p>
        </div>
        <StatusPill tone={!account.active ? "grey" : account.authUserId ? "green" : "amber"}>{state}</StatusPill>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ProductionActionForm action={updateStaffAccountRoleAction} submitLabel="Update role">
          <input type="hidden" name="accountId" value={account.id} />
          <Field label="Role"><select className={inputClassName()} name="role" defaultValue={account.role}><option value="staff">Staff</option><option value="manager">Manager</option></select></Field>
        </ProductionActionForm>
        {!account.authUserId && (
          <ProductionActionForm action={inviteStaffAccountAction} submitLabel="Send Supabase invitation">
            <input type="hidden" name="accountId" value={account.id} />
            <p className="text-sm text-slate-600">Creates one Auth user for this existing staff profile and emails the configured address.</p>
            {!adminConfigured && <input type="hidden" name="unavailable" value="1" />}
          </ProductionActionForm>
        )}
        {!account.authUserId && (
          <ProductionActionForm action={linkExistingAuthUserAction} submitLabel="Link existing Auth user">
            <input type="hidden" name="accountId" value={account.id} />
            <Field label="Existing Auth user UUID"><input className={inputClassName()} name="authUserId" required /></Field>
          </ProductionActionForm>
        )}
        {account.active ? (
          <ProductionActionForm action={deactivateStaffAccountAction} submitLabel="Disable login" submitVariant="danger">
            <input type="hidden" name="accountId" value={account.id} />
          </ProductionActionForm>
        ) : (
          <ProductionActionForm action={reactivateStaffAccountAction} submitLabel="Enable login">
            <input type="hidden" name="accountId" value={account.id} />
          </ProductionActionForm>
        )}
      </div>
      {account.audit.length > 0 && (
        <div className="mt-5 border-t border-purple-100 pt-4">
          <h3 className="font-black text-purple-950">Recent access audit</h3>
          <ul className="mt-2 grid gap-1 text-sm text-slate-600">
            {account.audit.slice(0, 5).map((item) => <li key={item.id}>{item.action.replaceAll("_", " ")} by {item.performedByName}</li>)}
          </ul>
        </div>
      )}
    </Panel>
  );
}
