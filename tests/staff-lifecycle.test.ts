import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSeedState } from "@/lib/demo-data/seed";
import { setDemoStaffActive } from "@/lib/repositories/demo-store";

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
  const complianceScreen = source("src/components/compliance/production-compliance-screen.tsx");
  const complianceDetail = source("src/components/compliance/production-compliance-detail.tsx");

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

  it("does not let compliance actions update staff active status", () => {
    expect(complianceActions).not.toContain('active: bool(formData, "active")');
  });

  it("does not expose active status in compliance quick edits or detail forms", () => {
    expect(complianceScreen).not.toContain("defaultChecked={person.active}");
    expect(complianceDetail).not.toContain('name="active" type="checkbox"');
  });
});

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
