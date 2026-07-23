# Staff Lifecycle Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make People > Staff the single place to add, deactivate and reactivate staff members while preserving all history and disabling access safely.

**Architecture:** Move production profile creation into a focused staff server-action module and expose it from the Staff screen only. Add one manager-only PostgreSQL function that atomically deactivates the canonical profile, linked account and kiosk access, while reactivation restores only the profile. Keep demo data local and immutable by adding a pure state transition plus explicit lifecycle controls.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase PostgreSQL and RPC, Vitest 4, Tailwind CSS

## Global Constraints

- Use UK date, time and currency formats.
- Use the Europe/London timezone.
- Preserve original clock events and all historic attendance, rota, pay, compliance and account-audit records.
- Manager corrections remain separate from original clock records.
- Do not silently overwrite historic hourly rates or salary values.
- Never expose salary or pay-rate information on the public clocking kiosk.
- Staff cannot edit their own attendance history.
- Staff lifecycle actions are manager-only.
- Deactivation is not deletion.
- Deactivation disables a linked login and kiosk access atomically.
- Reactivation restores only the staff profile; login and kiosk access require separate manager actions.
- Keep touch targets large and accessible.
- Do not use em dashes in user-facing application copy.
- Do not add dependencies.
- Preserve demo functionality.

---

## File Structure

- Create `supabase/migrations/202607230001_staff_lifecycle_management.sql`: manager-only atomic profile/account/kiosk status operation.
- Create `src/lib/staff/actions.ts`: production profile creation, deactivation and reactivation server actions.
- Modify `src/components/staff/production-staff-screen.tsx`: production add form, confirmation UI and lifecycle controls.
- Modify `src/components/compliance/production-compliance-screen.tsx`: remove canonical staff creation.
- Modify `src/app/staff/page.tsx`: enable staff lifecycle controls only on the Staff route.
- Modify `src/lib/compliance/actions.ts`: remove the relocated creation action.
- Modify `src/lib/repositories/demo-store.tsx`: pure demo lifecycle transition and repository method.
- Modify `src/components/app/prototype-app.tsx`: explicit demo deactivate/reactivate controls.
- Create `tests/staff-lifecycle.test.ts`: database, action, route ownership and demo-state coverage.

### Task 1: Atomic production staff deactivation

**Files:**

- Create: `tests/staff-lifecycle.test.ts`
- Create: `supabase/migrations/202607230001_staff_lifecycle_management.sql`

**Interfaces:**

- Produces: PostgreSQL RPC `public.set_staff_profile_active(p_staff_id text, p_active boolean) returns void`
- Consumes: `public.current_staff_account()`, `public.staff_profiles`, `public.staff_accounts`, `public.staff_kiosk_settings`, `public.staff_account_access_audit`

- [ ] **Step 1: Write the failing migration contract tests**

Create `tests/staff-lifecycle.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

describe("staff lifecycle database operation", () => {
  const migration = source("supabase/migrations/202607230001_staff_lifecycle_management.sql");

  it("restricts profile lifecycle changes to managers", () => {
    expect(migration).toContain("create or replace function public.set_staff_profile_active");
    expect(migration).toContain("manager_account.role <> 'manager'");
    expect(migration).toContain("revoke all on function public.set_staff_profile_active(text, boolean)");
    expect(migration).toContain("grant execute on function public.set_staff_profile_active(text, boolean) to authenticated");
    expect(migration).not.toMatch(/grant execute on function public\.set_staff_profile_active\(text, boolean\) to anon/i);
  });

  it("deactivates profile, login and kiosk access in one transaction", () => {
    expect(migration).toContain("update public.staff_profiles");
    expect(migration).toContain("update public.staff_accounts");
    expect(migration).toContain("update public.staff_kiosk_settings");
    expect(migration).toContain("insert into public.staff_account_access_audit");
    expect(migration).toContain("'disabled'");
  });

  it("prevents self-deactivation and does not re-enable access", () => {
    expect(migration).toContain("manager_account.staff_id = p_staff_id");
    expect(migration).toContain("You cannot deactivate the account currently in use");
    expect(migration).toMatch(/if not p_active then[\s\S]*update public\.staff_accounts/);
    expect(migration).not.toMatch(/if p_active then[\s\S]*update public\.staff_accounts/);
    expect(migration).not.toMatch(/if p_active then[\s\S]*update public\.staff_kiosk_settings/);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- tests/staff-lifecycle.test.ts
```

Expected: FAIL because `supabase/migrations/202607230001_staff_lifecycle_management.sql` does not exist.

- [ ] **Step 3: Implement the atomic database function**

Create `supabase/migrations/202607230001_staff_lifecycle_management.sql`:

```sql
create or replace function public.set_staff_profile_active(
  p_staff_id text,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  manager_account public.staff_accounts;
  target_profile public.staff_profiles;
  target_account public.staff_accounts;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;

  select * into target_profile
  from public.staff_profiles
  where id = p_staff_id
  for update;

  if target_profile.id is null then
    raise exception 'Staff profile not found';
  end if;

  if not p_active and manager_account.staff_id = p_staff_id then
    raise exception 'You cannot deactivate the account currently in use';
  end if;

  update public.staff_profiles
  set active = p_active,
      updated_at = now()
  where id = p_staff_id;

  if not p_active then
    select * into target_account
    from public.staff_accounts
    where staff_id = p_staff_id
    for update;

    if target_account.id is not null and target_account.active then
      update public.staff_accounts
      set active = false,
          disabled_by = manager_account.id,
          disabled_at = now()
      where id = target_account.id;

      insert into public.staff_account_access_audit (
        staff_account_id,
        staff_id,
        action,
        previous_role,
        new_role,
        performed_by
      ) values (
        target_account.id,
        p_staff_id,
        'disabled',
        target_account.role,
        target_account.role,
        manager_account.id
      );
    end if;

    update public.staff_kiosk_settings
    set kiosk_enabled = false
    where staff_id = p_staff_id;
  end if;
end;
$$;

revoke all on function public.set_staff_profile_active(text, boolean)
from public, anon, authenticated;

grant execute on function public.set_staff_profile_active(text, boolean)
to authenticated;
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npm test -- tests/staff-lifecycle.test.ts
```

Expected: PASS with 3 tests passing.

- [ ] **Step 5: Commit the database operation**

```powershell
git add -- tests/staff-lifecycle.test.ts supabase/migrations/202607230001_staff_lifecycle_management.sql
git commit -m "Add atomic staff lifecycle operation"
```

### Task 2: Focused production staff server actions

**Files:**

- Create: `src/lib/staff/actions.ts`
- Modify: `src/lib/compliance/actions.ts`
- Modify: `tests/staff-lifecycle.test.ts`

**Interfaces:**

- Produces: `StaffActionState = { ok: boolean; message: string }`
- Produces: `createStaffProfileAction(state, formData)`, `deactivateStaffProfileAction(state, formData)`, `reactivateStaffProfileAction(state, formData)`
- Consumes: `public.set_staff_profile_active(p_staff_id text, p_active boolean)`

- [ ] **Step 1: Add failing action ownership and safety tests**

Append to `tests/staff-lifecycle.test.ts`:

```ts
describe("production staff lifecycle actions", () => {
  const actions = source("src/lib/staff/actions.ts");
  const complianceActions = source("src/lib/compliance/actions.ts");

  it("owns creation and lifecycle actions in the staff module", () => {
    expect(actions).toContain("createStaffProfileAction");
    expect(actions).toContain("deactivateStaffProfileAction");
    expect(actions).toContain("reactivateStaffProfileAction");
    expect(complianceActions).not.toContain("createStaffProfileAction");
  });

  it("requires manager access and rejects current-manager deactivation", () => {
    expect(actions).toContain('requireAccount(["manager"])');
    expect(actions).toContain("manager.staffId === staffId");
    expect(actions).toContain("You cannot deactivate your own staff profile.");
  });

  it("uses the atomic RPC and refreshes affected manager routes", () => {
    expect(actions).toContain('rpc("set_staff_profile_active"');
    expect(actions).toContain('revalidatePath("/staff")');
    expect(actions).toContain('revalidatePath("/accounts")');
    expect(actions).toContain('revalidatePath("/settings/kiosk")');
    expect(actions).toContain('revalidatePath("/compliance")');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- tests/staff-lifecycle.test.ts
```

Expected: FAIL because `src/lib/staff/actions.ts` does not exist.

- [ ] **Step 3: Create the staff action module and relocate creation**

Create `src/lib/staff/actions.ts` with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

export type StaffActionState = { ok: boolean; message: string };

const fail = (message: string): StaffActionState => ({ ok: false, message });
const ok = (message: string): StaffActionState => ({ ok: true, message });

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function refreshStaffPaths(staffId: string) {
  revalidatePath("/staff");
  revalidatePath("/accounts");
  revalidatePath("/settings/kiosk");
  revalidatePath("/clock");
  revalidatePath("/rota");
  revalidatePath("/compliance");
  revalidatePath(`/compliance/staff/${staffId}`);
}

export async function createStaffProfileAction(
  _state: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  await requireAccount(["manager"]);
  const fullName = text(formData, "fullName");
  const employmentRole = text(formData, "employmentRole");
  if (!fullName || !employmentRole) return fail("Full name and role are required.");
  const id = crypto.randomUUID();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("staff_profiles").insert({
    id,
    full_name: fullName,
    display_name: text(formData, "displayName") ?? fullName.split(" ")[0],
    employment_role: employmentRole,
    main_qualification_level: text(formData, "mainQualificationLevel"),
    appointment_date: text(formData, "appointmentDate"),
    active: formData.get("active") === "on",
  });
  if (error) return fail("Staff profile could not be created. Check for a duplicate staff record.");
  revalidatePath("/staff");
  revalidatePath("/compliance");
  redirect(`/compliance/staff/${id}`);
}

export async function deactivateStaffProfileAction(
  _state: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const manager = await requireAccount(["manager"]);
  const staffId = text(formData, "staffId");
  if (!staffId) return fail("Staff profile is required.");
  if (manager.staffId === staffId) return fail("You cannot deactivate your own staff profile.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_staff_profile_active", {
    p_staff_id: staffId,
    p_active: false,
  });
  if (error) return fail("Staff member could not be deactivated.");
  refreshStaffPaths(staffId);
  return ok("Staff member deactivated. Their history has been preserved.");
}

export async function reactivateStaffProfileAction(
  _state: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  await requireAccount(["manager"]);
  const staffId = text(formData, "staffId");
  if (!staffId) return fail("Staff profile is required.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_staff_profile_active", {
    p_staff_id: staffId,
    p_active: true,
  });
  if (error) return fail("Staff member could not be reactivated.");
  refreshStaffPaths(staffId);
  return ok("Staff member reactivated. Login and kiosk access remain disabled.");
}
```

Remove `createStaffProfileAction` from `src/lib/compliance/actions.ts`. Keep its shared `text`, `bool`, `ok`, `fail` and all compliance-only actions unchanged.

- [ ] **Step 4: Run the focused test and typecheck**

Run:

```powershell
npm test -- tests/staff-lifecycle.test.ts
npm run typecheck
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the staff actions**

```powershell
git add -- src/lib/staff/actions.ts src/lib/compliance/actions.ts tests/staff-lifecycle.test.ts
git commit -m "Add manager staff lifecycle actions"
```

### Task 3: Move production staff creation and lifecycle controls into Staff

**Files:**

- Modify: `src/components/staff/production-staff-screen.tsx`
- Modify: `src/components/compliance/production-compliance-screen.tsx`
- Modify: `src/app/staff/page.tsx`
- Modify: `tests/staff-lifecycle.test.ts`

**Interfaces:**

- Consumes: `createStaffProfileAction`, `deactivateStaffProfileAction`, `reactivateStaffProfileAction`
- Produces: `ProductionStaffScreen({ staff, showStaffLifecycleControls?: boolean, currentStaffId?: string })`
- Constraint: `/payroll/arrangements` continues using `ProductionStaffScreen` without staff lifecycle controls.

- [ ] **Step 1: Add failing route ownership and UI-copy tests**

Append to `tests/staff-lifecycle.test.ts`:

```ts
describe("production staff lifecycle interface", () => {
  const staffScreen = source("src/components/staff/production-staff-screen.tsx");
  const complianceScreen = source("src/components/compliance/production-compliance-screen.tsx");
  const staffPage = source("src/app/staff/page.tsx");
  const payPage = source("src/app/payroll/arrangements/page.tsx");

  it("creates staff from Staff and not Compliance", () => {
    expect(staffScreen).toContain("Add staff member");
    expect(staffScreen).toContain("createStaffProfileAction");
    expect(complianceScreen).not.toContain("Add staff member");
    expect(complianceScreen).not.toContain("createStaffProfileAction");
  });

  it("shows explicit deactivate, confirmation and reactivate controls", () => {
    expect(staffScreen).toContain("Deactivate staff member");
    expect(staffScreen).toContain("Confirm deactivation");
    expect(staffScreen).toContain("History will be preserved");
    expect(staffScreen).toContain("Reactivate staff member");
    expect(staffScreen).toContain("Login and kiosk access will remain disabled");
  });

  it("enables lifecycle controls on Staff but not Pay arrangements", () => {
    expect(staffPage).toContain("showStaffLifecycleControls");
    expect(staffPage).toContain("currentStaffId={manager.staffId}");
    expect(payPage).not.toContain("showStaffLifecycleControls");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- tests/staff-lifecycle.test.ts
```

Expected: FAIL because the add form is still in Compliance and lifecycle copy is absent from Staff.

- [ ] **Step 3: Remove creation from the production Compliance screen**

In `src/components/compliance/production-compliance-screen.tsx`:

- remove `Field` and `inputClassName` from the primitives import if no longer used;
- remove `createStaffProfileAction` from the actions import;
- remove the entire panel headed `Add staff member`;
- retain the dashboard counts, quick edits and staff-record links.

- [ ] **Step 4: Add the production Staff create form**

Change the screen signature and add imports:

```ts
import { ProductionActionForm } from "@/components/compliance/production-action-form";
import {
  createStaffProfileAction,
  deactivateStaffProfileAction,
  reactivateStaffProfileAction,
} from "@/lib/staff/actions";

export function ProductionStaffScreen({
  staff,
  showStaffLifecycleControls = false,
  currentStaffId,
}: {
  staff: ProductionStaffRow[];
  showStaffLifecycleControls?: boolean;
  currentStaffId?: string;
}) {
```

Before the search panel, render this only when `showStaffLifecycleControls` is true:

```tsx
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
```

- [ ] **Step 5: Add accessible card-level lifecycle confirmation**

Pass the lifecycle props into each card:

```tsx
{filtered.map((person) => (
  <StaffPayCard
    key={person.id}
    person={person}
    showStaffLifecycleControls={showStaffLifecycleControls}
    currentStaffId={currentStaffId}
  />
))}
```

Update the card signature:

```ts
function StaffPayCard({
  person,
  showStaffLifecycleControls,
  currentStaffId,
}: {
  person: ProductionStaffRow;
  showStaffLifecycleControls: boolean;
  currentStaffId?: string;
}) {
```

Inside the card, add:

```ts
const [confirmingDeactivation, setConfirmingDeactivation] = useState(false);
```

For active, non-current-manager cards render:

```tsx
{showStaffLifecycleControls && person.active && person.id !== currentStaffId && (
  <button
    className="min-h-11 rounded-xl bg-red-700 px-4 text-sm font-bold text-white"
    type="button"
    onClick={() => setConfirmingDeactivation(true)}
  >
    Deactivate staff member
  </button>
)}
```

Render the explicit confirmation panel:

```tsx
{confirmingDeactivation && (
  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
    <p className="font-black text-red-950">Confirm deactivation</p>
    <p className="mt-2 text-sm text-red-900">
      This disables the staff login and kiosk clocking access. History will be preserved.
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
```

For inactive cards render:

```tsx
{showStaffLifecycleControls && !person.active && (
  <div>
    <ProductionActionForm action={reactivateStaffProfileAction} submitLabel="Reactivate staff member">
      <input type="hidden" name="staffId" value={person.id} />
    </ProductionActionForm>
    <p className="mt-2 text-xs text-slate-600">Login and kiosk access will remain disabled.</p>
  </div>
)}
```

Do not render a deactivate control when `person.id === currentStaffId`. Other manager profiles may still be deactivated by an authorised manager. The server action and database function remain the authoritative self-deactivation guards.

- [ ] **Step 6: Enable controls only from the Staff route**

In `src/app/staff/page.tsx`, retain the result of the existing authorisation check:

```ts
const manager = await requireAccount(["manager"]);
```

Then change:

```tsx
<ProductionStaffScreen staff={staff} />
```

to:

```tsx
<ProductionStaffScreen
  staff={staff}
  showStaffLifecycleControls
  currentStaffId={manager.staffId}
/>
```

Leave `src/app/payroll/arrangements/page.tsx` unchanged so it continues to use the default `false`.

- [ ] **Step 7: Run focused tests, lint and typecheck**

Run:

```powershell
npm test -- tests/staff-lifecycle.test.ts
npm run lint
npm run typecheck
```

Expected: all commands PASS with no errors.

- [ ] **Step 8: Commit the production interface**

```powershell
git add -- src/components/staff/production-staff-screen.tsx src/components/compliance/production-compliance-screen.tsx src/app/staff/page.tsx tests/staff-lifecycle.test.ts
git commit -m "Move staff lifecycle controls into Staff"
```

### Task 4: Preserve and clarify demo staff lifecycle behaviour

**Files:**

- Modify: `src/lib/repositories/demo-store.tsx`
- Modify: `src/components/app/prototype-app.tsx`
- Modify: `tests/staff-lifecycle.test.ts`

**Interfaces:**

- Produces: `setDemoStaffActive(state: DemoState, staffId: string, active: boolean): DemoState`
- Produces repository method: `setStaffActive(staffId: string, active: boolean): void`
- Consumes: existing demo `staff`, `staffAccounts`, immutable clock, rota, pay and compliance-adjacent state

- [ ] **Step 1: Add failing demo-state preservation tests**

Add these imports to `tests/staff-lifecycle.test.ts`:

```ts
import { createSeedState } from "@/lib/demo-data/seed";
import { setDemoStaffActive } from "@/lib/repositories/demo-store";
```

Append:

```ts
describe("demo staff lifecycle", () => {
  it("deactivates the profile and linked account without deleting history", () => {
    const state = createSeedState();
    const staffId = state.staffAccounts[0].staffId;
    const before = {
      clockEvents: state.clockEvents.length,
      rota: state.rota.length,
      payRates: state.payRates.length,
    };
    const next = setDemoStaffActive(state, staffId, false);
    expect(next.staff.find((person) => person.id === staffId)?.active).toBe(false);
    expect(next.staffAccounts.find((account) => account.staffId === staffId)?.active).toBe(false);
    expect(next.clockEvents).toHaveLength(before.clockEvents);
    expect(next.rota).toHaveLength(before.rota);
    expect(next.payRates).toHaveLength(before.payRates);
  });

  it("reactivates only the profile", () => {
    const state = createSeedState();
    const staffId = state.staffAccounts[0].staffId;
    const deactivated = setDemoStaffActive(state, staffId, false);
    const reactivated = setDemoStaffActive(deactivated, staffId, true);
    expect(reactivated.staff.find((person) => person.id === staffId)?.active).toBe(true);
    expect(reactivated.staffAccounts.find((account) => account.staffId === staffId)?.active).toBe(false);
  });

  it("shows explicit demo lifecycle controls", () => {
    const screen = source("src/components/app/prototype-app.tsx");
    expect(screen).toContain("Deactivate staff member");
    expect(screen).toContain("Reactivate staff member");
    expect(screen).toContain("History will be preserved");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- tests/staff-lifecycle.test.ts
```

Expected: FAIL because `setDemoStaffActive` and the explicit demo controls do not exist.

- [ ] **Step 3: Implement the pure demo lifecycle transition**

In `src/lib/repositories/demo-store.tsx`, add:

```ts
export function setDemoStaffActive(state: DemoState, staffId: string, active: boolean): DemoState {
  const updatedAt = new Date().toISOString();
  return {
    ...state,
    staff: state.staff.map((person) =>
      person.id === staffId
        ? { ...person, active, employmentStatus: active ? "employed" : "former", updatedAt }
        : person,
    ),
    staffAccounts: active
      ? state.staffAccounts
      : state.staffAccounts.map((account) =>
          account.staffId === staffId ? { ...account, active: false, updatedAt } : account,
        ),
  };
}
```

Add to `DemoRepository`:

```ts
setStaffActive: (staffId: string, active: boolean) => void;
```

Add to the memoised repository:

```ts
setStaffActive: (staffId, active) =>
  setState((current) => setDemoStaffActive(current, staffId, active)),
```

- [ ] **Step 4: Add explicit demo Staff controls**

In the demo `StaffScreen`:

```ts
const [confirmingStaffId, setConfirmingStaffId] = useState<string | null>(null);
```

Replace the single Edit action cell with a flex group containing Edit plus:

```tsx
{person.active ? (
  <Button variant="danger" onClick={() => setConfirmingStaffId(person.id)}>
    Deactivate staff member
  </Button>
) : (
  <Button variant="secondary" onClick={() => repo.setStaffActive(person.id, true)}>
    Reactivate staff member
  </Button>
)}
```

Below the table, render this confirmation when a staff ID is selected:

```tsx
{confirmingStaffId && (
  <Panel className="mt-4 border-red-200 bg-red-50">
    <h2 className="font-black text-red-950">Confirm deactivation</h2>
    <p className="mt-2 text-sm text-red-900">
      Login and kiosk access will be disabled. History will be preserved.
    </p>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button
        variant="danger"
        onClick={() => {
          repo.setStaffActive(confirmingStaffId, false);
          setConfirmingStaffId(null);
        }}
      >
        Confirm deactivation
      </Button>
      <Button variant="secondary" onClick={() => setConfirmingStaffId(null)}>Cancel</Button>
    </div>
  </Panel>
)}
```

Keep the existing Add staff member modal and Edit modal unchanged.

- [ ] **Step 5: Run focused tests and repository regression tests**

Run:

```powershell
npm test -- tests/staff-lifecycle.test.ts tests/repository-persistence.test.ts
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit demo lifecycle controls**

```powershell
git add -- src/lib/repositories/demo-store.tsx src/components/app/prototype-app.tsx tests/staff-lifecycle.test.ts
git commit -m "Add explicit demo staff lifecycle controls"
```

### Task 5: Full verification and user-flow check

**Files:**

- Verify all files changed in Tasks 1 to 4.
- Do not modify unrelated dirty files.

**Interfaces:**

- Consumes: complete staff lifecycle implementation.
- Produces: verified local feature with no claimed success before evidence.

- [ ] **Step 1: Run the complete automated checks**

Run:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all four commands exit with code 0. If any fail, fix only failures caused by this feature and rerun the failed command followed by the complete set.

- [ ] **Step 2: Run the application**

Run:

```powershell
npm run dev
```

Expected: Next.js reports a local development URL with no startup error.

- [ ] **Step 3: Verify the production manager workflow in the browser**

With production configuration and a manager session:

1. Open `/staff`.
2. Confirm Add staff member is above the search and staff list.
3. Submit without full name and confirm browser/server validation blocks creation.
4. Create a realistic staff member using UK-formatted dates.
5. Confirm the new profile opens at `/compliance/staff/<id>`.
6. Return to `/staff`, deactivate the profile and confirm the warning appears before submission.
7. Confirm the profile disappears from the active list.
8. Enable Include inactive staff and confirm the profile appears as inactive.
9. Confirm Accounts shows the linked login disabled when one exists.
10. Confirm Kiosk setup shows kiosk access disabled when settings exist.
11. Reactivate the profile and confirm login and kiosk access remain disabled.
12. Open `/compliance` and confirm there is no Add staff member form.
13. Open `/payroll/arrangements` and confirm lifecycle controls are not duplicated there.

- [ ] **Step 4: Verify demo mode**

Run the app with `APP_MODE=demo`, then:

1. Open `/staff`.
2. Confirm the existing Add staff member modal still works.
3. Deactivate a demo staff member through the explicit confirmation.
4. Confirm they disappear from Active only.
5. Select Inactive only and reactivate them.
6. Confirm existing demo rota, attendance and pay history remains visible.

- [ ] **Step 5: Inspect the final diff**

Run:

```powershell
git status --short
git diff --check
git log -5 --oneline
```

Expected: no whitespace errors; only intended staff lifecycle files plus the user's pre-existing unrelated changes are present.

- [ ] **Step 6: Commit any verification-only fixes**

If verification required code changes:

```powershell
git add -- <only-files-changed-for-staff-lifecycle>
git commit -m "Fix staff lifecycle verification issues"
```

If no fixes were required, do not create an empty commit.
