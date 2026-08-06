import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { kioskRepositorySource, mapKioskRoster } from "@/lib/kiosk/server";
import { kioskResultMessage, validateKioskPin } from "@/lib/kiosk/security";
import { KIOSK_DEVICE_COOKIE } from "@/lib/kiosk/device-session";
import { currentWorkWeekRange, summariseCompletedClockMinutes } from "@/lib/attendance/hours";

describe("production kiosk separation", () => {
  it("uses Supabase in production and never falls back to demo data", () => {
    expect(kioskRepositorySource("production", true)).toBe("supabase");
    expect(() => kioskRepositorySource("production", false)).toThrow(/requires Supabase/i);
    expect(kioskRepositorySource("demo", false)).toBe("demo");
  });

  it("maps only limited roster fields and never returns a PIN hash", () => {
    const roster = mapKioskRoster([{
      staff_id: "canonical-uuid",
      display_name: "Areeg",
      full_name: "Areeg Shahzadi",
      employment_role: "Nursery Practitioner",
      current_status: "clocked_out",
      pin_ready: true,
    }]);
    expect(roster[0]).toEqual({
      staffId: "canonical-uuid",
      displayName: "Areeg",
      fullName: "Areeg Shahzadi",
      employmentRole: "Nursery Practitioner",
      currentStatus: "clocked_out",
      pinReady: true,
    });
    expect(JSON.stringify(roster)).not.toContain("hash");
  });
});

describe("production kiosk migration safeguards", () => {
  const migration = readFileSync(resolve("supabase/migrations/202606110002_production_kiosk_attendance.sql"), "utf8");
  const noLockoutMigration = readFileSync(resolve("supabase/migrations/20260618232128_remove_kiosk_pin_lockout.sql"), "utf8");
  const pgcryptoFix = readFileSync(resolve("supabase/migrations/202606110003_kiosk_pgcrypto_search_path.sql"), "utf8");
  const columnSecurity = readFileSync(resolve("supabase/migrations/202606110004_kiosk_pin_hash_column_security.sql"), "utf8");
  const correctionMigration = readFileSync(resolve("supabase/migrations/20260728230702_clock_event_corrections.sql"), "utf8");

  it("keeps PIN hashes private and verifies them inside security-definer functions", () => {
    expect(migration).toContain("pin_hash text");
    expect(migration).toContain("crypt(candidate_pin, settings.pin_hash)");
    expect(migration).toContain("revoke all on public.staff_kiosk_settings from anon");
    expect(migration).not.toMatch(/returns table[\\s\\S]{0,300}pin_hash/i);
    expect(pgcryptoFix).toContain("search_path = public, extensions");
    expect(columnSecurity).toContain("revoke all on public.staff_kiosk_settings from authenticated");
    expect(columnSecurity).not.toMatch(/grant select[\\s\\S]*pin_hash/i);
  });

  it("records failed attempts without locking staff out and prevents invalid clock transitions", () => {
    expect(noLockoutMigration).toContain("failed_attempt_count = failed_attempt_count + 1");
    expect(noLockoutMigration).toContain("locked_until = null");
    expect(noLockoutMigration).not.toContain("interval '15 minutes'");
    expect(noLockoutMigration).not.toContain("'locked'");
    expect(migration).toContain("'already_clocked_in'");
    expect(migration).toContain("'not_clocked_in'");
    expect(migration).toContain("interval '5 seconds'");
  });

  it("locks on the fourth failed attempt and reports remaining attempts before lockout", () => {
    const lockoutMigration = readFileSync(resolve("supabase/migrations/202607060001_kiosk_lockout_weekly_hours.sql"), "utf8");
    expect(lockoutMigration).toContain("failures >= 4");
    expect(lockoutMigration).toContain("now() + interval '15 minutes'");
    expect(lockoutMigration).toContain("'invalid_pin_attempt_1'");
    expect(lockoutMigration).toContain("'invalid_pin_attempt_2'");
    expect(lockoutMigration).toContain("'invalid_pin_attempt_3'");
    expect(lockoutMigration).toContain("'locked'");
    expect(lockoutMigration).toContain("set failed_attempt_count = 0, locked_until = null");
  });

  it("keeps original events immutable and restricts corrections to managers", () => {
    expect(migration).toContain("Managers can add clock corrections");
    expect(migration).toContain("event_source = 'manager'");
    expect(migration).toContain("manager_correction = true");
    expect(migration).not.toMatch(/create policy [\\s\\S]* clock_events for update/i);
  });

  it("resolves bounded effective status inside public kiosk RPCs", () => {
    expect(correctionMigration).toContain("get_latest_effective_clock_event");
    expect(correctionMigration).toMatch(/get_kiosk_roster[\s\S]*get_latest_effective_clock_event/i);
    expect(correctionMigration).toMatch(/verify_kiosk_pin[\s\S]*get_latest_effective_clock_event/i);
    expect(correctionMigration).toMatch(/record_kiosk_clock_event[\s\S]*get_latest_effective_clock_event/i);
    expect(correctionMigration).toMatch(/record_kiosk_clock_event[\s\S]*lock_attendance_staff_writes/i);
    expect(correctionMigration).toContain("grant execute on function public.get_device_kiosk_roster(text) to anon, authenticated");
    expect(correctionMigration).not.toMatch(/grant execute on function public\.get_kiosk_roster\(\) to anon/i);
  });
});

describe("device-specific kiosk access", () => {
  const migration = readFileSync(resolve("supabase/migrations/202606120002_kiosk_devices_manager_access.sql"), "utf8");
  const middleware = readFileSync(resolve("middleware.ts"), "utf8");
  const kioskServer = readFileSync(resolve("src/lib/kiosk/server.ts"), "utf8");
  const kioskActions = readFileSync(resolve("src/lib/kiosk/actions.ts"), "utf8");
  const stateMigration = readFileSync(resolve("supabase/migrations/20260803160623_attendance_state_machine.sql"), "utf8");
  const verificationMigration = readFileSync(resolve("supabase/migrations/20260803162518_kiosk_attendance_state_response.sql"), "utf8");

  it("stores only token hashes and supports expiry and revocation", () => {
    expect(migration).toContain("token_hash bytea not null unique");
    expect(migration).toContain("expires_at timestamptz not null");
    expect(migration).toContain("revoked_by uuid");
    expect(migration).toContain("digest(candidate_token, 'sha256')");
    expect(migration).not.toContain("device_token text not null");
  });

  it("revokes anonymous access to legacy kiosk RPCs", () => {
    expect(migration).toContain("revoke execute on function public.get_kiosk_roster() from anon, authenticated");
    expect(migration).toContain("revoke execute on function public.verify_kiosk_pin(text, text) from anon, authenticated");
    expect(migration).toContain("revoke execute on function public.record_kiosk_clock_event(text, text, text, text) from anon, authenticated");
    expect(kioskServer).toContain("get_tenant_aware_device_kiosk_roster");
    expect(kioskActions).toContain("perform_tenant_aware_kiosk_attendance_action");
    expect(stateMigration).toContain("idempotency_key uuid primary key");
    expect(verificationMigration).toContain("'attendanceState', attendance_state");
    expect(verificationMigration).not.toMatch(/jsonb_build_object[\s\S]*pin_hash/i);
  });

  it("keeps the device token in an HttpOnly cookie and redirects manager routes", () => {
    expect(KIOSK_DEVICE_COOKIE).toBe("workforce_clocking_device");
    const deviceSession = readFileSync(resolve("src/lib/kiosk/device-session.ts"), "utf8");
    expect(deviceSession).toContain("httpOnly: true");
    expect(deviceSession).toContain("LEGACY_KIOSK_DEVICE_COOKIES");
    expect(deviceSession).not.toContain("localStorage");
    expect(middleware).toContain('url.pathname = "/clock"');
  });

  it("does not mislabel a roster error as an unregistered browser", () => {
    const clockPage = readFileSync(resolve("src/app/clock/page.tsx"), "utf8");
    expect(clockPage).toContain("Staff Clock could not load");
    expect(clockPage).toContain("This browser is registered");
    expect(clockPage).toContain("Remove saved registration");
    expect(clockPage).toContain("Staff Clock setup required");
    expect(kioskServer).toContain("KioskDeviceAccessError");
  });

  it("does not expose payroll or compliance fields in the roster", () => {
    expect(migration).not.toMatch(/get_device_kiosk_roster[\s\S]*hourly_rate/i);
    expect(migration).not.toMatch(/get_device_kiosk_roster[\s\S]*annual_salary/i);
    expect(migration).not.toMatch(/get_device_kiosk_roster[\s\S]*dbs_/i);
  });

  it("uses the bounded manager effective-status RPC instead of a historic scan", () => {
    expect(kioskServer).toContain('rpc("get_manager_kiosk_statuses"');
    expect(kioskServer).not.toContain('range_start: "1970-01-01"');
  });
});

describe("manager access workflow", () => {
  const migration = readFileSync(resolve("supabase/migrations/202606120002_kiosk_devices_manager_access.sql"), "utf8");
  const auditMigration = readFileSync(resolve("supabase/migrations/202606130005_production_account_access_audit.sql"), "utf8");
  const preparationMigration = readFileSync(resolve("supabase/migrations/202606130006_transactional_account_preparation.sql"), "utf8");
  const linker = readFileSync(resolve("scripts/link-existing-manager.ps1"), "utf8");
  const accounts = readFileSync(resolve("src/lib/accounts/server.ts"), "utf8");

  it("records who granted and disabled access", () => {
    expect(migration).toContain("access_granted_by");
    expect(migration).toContain("disabled_by");
    expect(accounts).toContain('supabase.rpc("prepare_staff_account"');
    expect(preparationMigration).toContain("access_granted_by");
    expect(accounts).toContain('supabase.rpc("set_staff_account_active"');
    expect(auditMigration).toContain("disabled_by = case when p_active then null else manager_account.id end");
    expect(auditMigration).toContain("staff_account_access_audit");
  });

  it("links an Auth user to an existing profile without a password", () => {
    expect(linker).toContain("Existing canonical staff profile UUID");
    expect(linker).toContain("from auth.users");
    expect(linker).toContain("update public.staff_profiles");
    expect(linker).not.toMatch(/password/i);
  });
});

describe("kiosk PIN safety", () => {
  const temporaryPinMigration = readFileSync(resolve("supabase/migrations/202606130004_kiosk_temporary_pin_change.sql"), "utf8");

  it("rejects weak, repeated and year-like PINs", () => {
    for (const pin of ["0000", "1111", "1234", "4321", "1990", "2026", "12", "abcdef"]) {
      expect(validateKioskPin(pin)).toBeTruthy();
    }
  });

  it("accepts a non-trivial four to six digit PIN", () => {
    expect(validateKioskPin("4827")).toBeNull();
    expect(validateKioskPin("583027")).toBeNull();
  });

  it("provides safe workflow errors", () => {
    expect(kioskResultMessage("already_clocked_in")).toMatch(/already clocked in/i);
    expect(kioskResultMessage("not_clocked_in")).toMatch(/cannot clock out/i);
    expect(kioskResultMessage("invalid_pin_attempt_1")).toMatch(/2 attempts remaining/i);
    expect(kioskResultMessage("invalid_pin_attempt_2")).toMatch(/1 attempt remaining/i);
    expect(kioskResultMessage("invalid_pin_attempt_3")).toMatch(/last attempt/i);
    expect(kioskResultMessage("locked")).toMatch(/15 minutes/i);
  });

  it("forces temporary PIN replacement before clocking", () => {
    const actions = readFileSync(resolve("src/lib/kiosk/actions.ts"), "utf8");
    const kiosk = readFileSync(resolve("src/components/kiosk/production-kiosk.tsx"), "utf8");
    const manager = readFileSync(resolve("src/components/kiosk/staff-kiosk-management.tsx"), "utf8");

    expect(temporaryPinMigration).toContain("'change_required'");
    expect(temporaryPinMigration).toContain("change_device_kiosk_pin");
    expect(temporaryPinMigration).toContain("pin_reset_required = false");
    expect(temporaryPinMigration).toContain("perform public.require_kiosk_device(device_token)");
    expect(temporaryPinMigration).not.toMatch(/returns table[\\s\\S]{0,300}pin_hash/i);
    expect(actions).toContain("changeTemporaryKioskPinAction");
    expect(kiosk).toContain('dispatch({ type: "change_required" })');
    expect(kiosk).toContain("<PinKeypad");
    expect(manager).not.toContain("pinResetRequired");
    expect(manager).not.toContain('name="requireChange"');
    expect(manager).toContain("Every temporary PIN must be replaced");
    expect(actions).toContain("require_change: true");
    expect(actions).not.toContain('formData.get("requireChange")');
  });

  it("keeps setup controls out of attendance", () => {
    const attendance = readFileSync(resolve("src/components/attendance/production-attendance.tsx"), "utf8");
    const setup = readFileSync(resolve("src/app/settings/kiosk/page.tsx"), "utf8");
    const devices = readFileSync(resolve("src/components/kiosk/device-management.tsx"), "utf8");
    expect(attendance).not.toContain("setKioskPinAction");
    expect(attendance).not.toContain("saveKioskSettingsAction");
    expect(setup).not.toContain("StaffKioskManagement");
    expect(setup).not.toContain("loadManagerAttendance");
    expect(setup).toContain("Clocking-in devices");
    expect(setup).toContain('href="/clock"');
    expect(setup).toContain("Open Staff Clock");
    expect(devices).toContain("Register this browser");
    expect(devices).toContain("Registered devices");
    expect(devices).toContain("Revoke device");
    expect(devices).toContain("Refresh Staff Clock");
  });

  it("refreshes Staff Clock consumers without changing database records", () => {
    const actions = readFileSync(resolve("src/lib/kiosk/actions.ts"), "utf8");
    const start = actions.indexOf("export async function refreshStaffClockAction");
    const refresh = actions.slice(start, actions.indexOf("\n}", start) + 2);

    expect(start).toBeGreaterThan(-1);
    expect(refresh).toContain('requireAccount(["manager"])');
    const revalidatedPaths = Array.from(
      refresh.matchAll(/revalidatePath\("([^"]+)"\)/g),
      ([, path]) => path,
    );
    expect(revalidatedPaths).toEqual([
      "/clock",
      "/settings/kiosk",
      "/attendance",
      "/staff",
    ]);
    expect(refresh).toContain('code: "refreshed"');
    expect(refresh).toContain('message: "Staff Clock information refreshed."');
    expect(refresh).not.toMatch(/supabase|insert|update|delete|upsert|rpc|clock_events/i);
  });

  it("uses clear Staff Clock terminology", () => {
    const clock = readFileSync(resolve("src/app/clock/page.tsx"), "utf8");
    const kiosk = readFileSync(resolve("src/components/kiosk/production-kiosk.tsx"), "utf8");
    expect(clock).not.toContain("Manager sign in");
    expect(clock).toContain("Staff Clock setup required");
    expect(kiosk).toContain(">Staff Clock<");
  });

  it("reuses one-person clocking controls without exposing pay data", () => {
    const clocking = readFileSync(resolve("src/components/staff/staff-record-clocking.tsx"), "utf8");
    const devices = readFileSync(resolve("src/components/kiosk/device-management.tsx"), "utf8");
    const manager = readFileSync(resolve("src/components/kiosk/staff-kiosk-management.tsx"), "utf8");
    expect(devices).toContain("Refresh Staff Clock");
    expect(clocking).toContain("<StaffKioskControl");
    expect(clocking).not.toMatch(/hourlyRate|annualSalary|monthlySalary/);
    expect(manager).toContain("export function StaffKioskControl");
    expect(manager).toContain("Every temporary PIN must be replaced");
    const route = readFileSync(resolve("src/app/compliance/staff/[staffId]/page.tsx"), "utf8");
    expect(clocking).toContain("<RefreshStaffClockControl");
    expect(devices).toContain("refreshStaffClockAction");
    expect(route).not.toContain("async function refreshStaffClock");
    expect(route).not.toContain('from "next/cache"');
  });

  it("keeps account identifiers under advanced details while retaining audited actions", () => {
    const login = readFileSync(resolve("src/components/staff/staff-record-login.tsx"), "utf8");
    const accounts = readFileSync(resolve("src/components/accounts/production-accounts.tsx"), "utf8");
    expect(login).toContain("<StaffAccountControl");
    expect(accounts).toContain("export function StaffAccountControl");
    expect(accounts).toContain(">Advanced details</summary>");
    expect(accounts).toContain("Recent access audit");
    expect(accounts).not.toContain("Existing Auth user UUID");
  });
});

describe("kiosk weekly hours", () => {
  it("defaults the current work week to Monday", () => {
    expect(currentWorkWeekRange("2026-07-09", 1)).toEqual({ start: "2026-07-06", end: "2026-07-12" });
  });

  it("uses the configured work-week start day", () => {
    expect(currentWorkWeekRange("2026-07-09", 7)).toEqual({ start: "2026-07-05", end: "2026-07-11" });
    expect(currentWorkWeekRange("2026-07-09", 3)).toEqual({ start: "2026-07-08", end: "2026-07-14" });
  });

  it("summarises only the selected staff member's completed shifts", () => {
    const summary = summariseCompletedClockMinutes([
      { staffId: "staff-a", eventType: "clock_in", eventTimestamp: "2026-07-06T08:00:00+01:00" },
      { staffId: "staff-a", eventType: "clock_out", eventTimestamp: "2026-07-06T12:30:00+01:00" },
      { staffId: "staff-b", eventType: "clock_in", eventTimestamp: "2026-07-06T09:00:00+01:00" },
      { staffId: "staff-b", eventType: "clock_out", eventTimestamp: "2026-07-06T17:00:00+01:00" },
    ], "staff-a", "2026-07-06", "2026-07-12");

    expect(summary.completedMinutes).toBe(270);
    expect(summary.hasOpenShift).toBe(false);
  });

  it("excludes incomplete shifts and marks them as in progress", () => {
    const summary = summariseCompletedClockMinutes([
      { staffId: "staff-a", eventType: "clock_in", eventTimestamp: "2026-07-06T08:00:00+01:00" },
      { staffId: "staff-a", eventType: "clock_out", eventTimestamp: "2026-07-06T12:00:00+01:00" },
      { staffId: "staff-a", eventType: "clock_in", eventTimestamp: "2026-07-06T13:00:00+01:00" },
    ], "staff-a", "2026-07-06", "2026-07-12");

    expect(summary.completedMinutes).toBe(240);
    expect(summary.hasOpenShift).toBe(true);
    expect(summary.hasUnresolvedException).toBe(true);
  });

  it("does not count a shift whose clock-out falls on the next operational day", () => {
    const summary = summariseCompletedClockMinutes([
      { staffId: "staff-a", eventType: "clock_in", eventTimestamp: "2026-07-06T23:30:00+01:00" },
      { staffId: "staff-a", eventType: "clock_out", eventTimestamp: "2026-07-07T00:30:00+01:00" },
    ], "staff-a", "2026-07-06", "2026-07-12");

    expect(summary.completedMinutes).toBe(0);
    expect(summary.hasOpenShift).toBe(true);
    expect(summary.hasUnresolvedException).toBe(true);
  });
});
