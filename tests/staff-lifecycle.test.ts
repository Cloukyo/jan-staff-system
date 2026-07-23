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
