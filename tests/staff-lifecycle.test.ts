import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSeedState } from "@/lib/demo-data/seed";
import { setDemoStaffActive } from "@/lib/repositories/demo-store";

function source(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

describe("staff lifecycle database operation", () => {
  const migration = source("supabase/migrations/202607230001_staff_lifecycle_management.sql");
  const enforcementMigrationPath = "supabase/migrations/202607230002_enforce_staff_lifecycle_paths.sql";
  const enforcementMigration = existsSync(resolve(enforcementMigrationPath)) ? source(enforcementMigrationPath) : "";

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

  it("limits authenticated staff profile updates to compliance fields", () => {
    expect(enforcementMigration).toMatch(/revoke update on table\s+public\.staff_profiles\s+from authenticated;/i);
    const grantedColumns = enforcementMigration
      .match(/grant update\s*\(([^)]+)\)\s*on table\s+public\.staff_profiles\s+to authenticated;/i)?.[1]
      .split(",")
      .map((column) => column.trim()) ?? [];
    expect(grantedColumns).toEqual([
      "full_name",
      "display_name",
      "employment_role",
      "main_qualification_level",
      "is_apprentice",
      "is_cover_staff",
      "appointment_date",
      "email",
      "notes",
      "updated_at",
    ]);
    expect(grantedColumns).not.toContain("active");
    expect(grantedColumns).not.toContain("auth_user_id");
    expect(grantedColumns).not.toContain("id");
    expect(grantedColumns).not.toContain("created_at");
  });

  it("removes direct authenticated account writes", () => {
    expect(enforcementMigration).toMatch(/revoke insert, update on table\s+public\.staff_accounts\s+from authenticated;/i);
  });

  it("guards every account activation and linking path with the profile status", () => {
    expect(enforcementMigration).toContain("create or replace function public.ensure_staff_account_profile_is_active");
    expect(enforcementMigration).toMatch(/if new\.active is true then[\s\S]*from public\.staff_profiles[\s\S]*where id = new\.staff_id/i);
    expect(enforcementMigration).toContain("linked_profile_active is not true");
    expect(enforcementMigration).toContain("Reactivate the staff profile before enabling login.");
    expect(enforcementMigration).toMatch(/before insert or update of active, staff_id\s+on public\.staff_accounts/i);
  });

  it("blocks installation when an inactive profile has an active account", () => {
    expect(enforcementMigration).toMatch(
      /select count\(\*\)[\s\S]*from public\.staff_profiles profile[\s\S]*join public\.staff_accounts account on account\.staff_id = profile\.id[\s\S]*where profile\.active is not true[\s\S]*and account\.active is true/i,
    );
  });

  it("blocks installation when an inactive profile has kiosk access", () => {
    expect(enforcementMigration).toMatch(
      /select count\(\*\)[\s\S]*from public\.staff_profiles profile[\s\S]*join public\.staff_kiosk_settings kiosk on kiosk\.staff_id = profile\.id[\s\S]*where profile\.active is not true[\s\S]*and kiosk\.kiosk_enabled is true/i,
    );
  });

  it("reports both preflight counts before installing lifecycle enforcement", () => {
    expect(enforcementMigration).toContain("if inconsistent_active_accounts > 0 or inconsistent_kiosk_settings > 0 then");
    expect(enforcementMigration).toContain("Staff lifecycle migration is blocked until inconsistent access is remediated.");
    expect(enforcementMigration.indexOf("select count(*)")).toBeLessThan(enforcementMigration.indexOf("revoke update on table public.staff_profiles"));
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

  it("checks the linked profile before enabling a staff account", () => {
    const reactivation = source("src/lib/accounts/server.ts").slice(
      source("src/lib/accounts/server.ts").indexOf("export async function reactivateStaffAccountAction"),
    );
    expect(reactivation).toContain('from("staff_profiles").select("active").eq("id", account.staffId).maybeSingle()');
    expect(reactivation).toContain("Reactivate the staff profile before enabling login.");
    expect(reactivation.indexOf('select("active")')).toBeLessThan(reactivation.indexOf('rpc("set_staff_account_active"'));
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
    expect(staffScreen).toContain("removed from active staff, rota and kiosk lists");
    expect(staffScreen).toContain("Attendance, rota, pay, audit and compliance history remains preserved");
    expect(staffScreen).not.toContain("—");
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
    const historicReferences = {
      clockEvents: state.clockEvents,
      rota: state.rota,
      payRates: state.payRates,
      leaveRequests: state.leaveRequests,
      attendanceAdjustments: state.attendanceAdjustments,
      attendanceApprovals: state.attendanceApprovals,
      paySummaries: state.paySummaries,
    };
    const historicSnapshots = structuredClone(historicReferences);
    const next = setDemoStaffActive(state, staffId, false);
    expect(next.staff.find((person) => person.id === staffId)?.active).toBe(false);
    expect(next.staffAccounts.find((account) => account.staffId === staffId)?.active).toBe(false);
    [
      ["clock events", next.clockEvents, historicReferences.clockEvents, historicSnapshots.clockEvents],
      ["rota", next.rota, historicReferences.rota, historicSnapshots.rota],
      ["pay rates", next.payRates, historicReferences.payRates, historicSnapshots.payRates],
      ["leave requests", next.leaveRequests, historicReferences.leaveRequests, historicSnapshots.leaveRequests],
      ["attendance adjustments", next.attendanceAdjustments, historicReferences.attendanceAdjustments, historicSnapshots.attendanceAdjustments],
      ["attendance approvals", next.attendanceApprovals, historicReferences.attendanceApprovals, historicSnapshots.attendanceApprovals],
      ["pay summaries", next.paySummaries, historicReferences.paySummaries, historicSnapshots.paySummaries],
    ].forEach(([name, after, beforeReference, beforeSnapshot]) => {
      expect(after, `${name} should retain its collection identity`).toBe(beforeReference);
      expect(after, `${name} should retain its content`).toEqual(beforeSnapshot);
    });
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

  it("keeps lifecycle changes out of the existing-staff edit route", () => {
    const screen = source("src/components/app/prototype-app.tsx");
    const staffModal = screen.slice(screen.indexOf("function StaffModal"), screen.indexOf("function RotaScreen"));
    const existingStaffSave = staffModal.slice(staffModal.indexOf("} else {"), staffModal.indexOf("repo.updateStaff(next"));

    expect(staffModal).toContain("{!staff && (");
    expect(staffModal).toContain("Active staff member");
    expect(existingStaffSave).toContain("active: staff.active");
    expect(existingStaffSave).toContain("employmentStatus: staff.employmentStatus");
    expect(existingStaffSave).not.toContain("active: form.active");
  });

  it("keeps staff creation and lifecycle controls out of demo Compliance", () => {
    const complianceScreen = source("src/components/compliance/staff-compliance-screen.tsx");
    expect(complianceScreen).not.toContain("Add staff member");
    expect(complianceScreen).not.toContain("function addStaff");
    expect(complianceScreen).not.toContain("newStaff");
    expect(complianceScreen).not.toContain('quickSave(person, "active"');
    expect(complianceScreen).not.toMatch(/field:\s*"employmentRole"\s*\|\s*"mainQualificationLevel"\s*\|\s*"active"/);
  });

  it("preserves active status when demo Compliance saves profile details", () => {
    const complianceDetail = source("src/components/compliance/staff-compliance-detail.tsx");
    const saveStaff = complianceDetail.slice(
      complianceDetail.indexOf("function saveStaff"),
      complianceDetail.indexOf("function upsertQualification"),
    );
    expect(complianceDetail).not.toContain('patchStaff("active"');
    expect(complianceDetail).not.toContain("checked={staff.active}");
    expect(saveStaff).toContain("active: item.active");
  });
});
