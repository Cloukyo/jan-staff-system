import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { kioskRepositorySource, mapKioskRoster } from "@/lib/kiosk/server";
import { kioskResultMessage, validateKioskPin } from "@/lib/kiosk/security";
import { KIOSK_DEVICE_COOKIE } from "@/lib/kiosk/device-session";

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
  const pgcryptoFix = readFileSync(resolve("supabase/migrations/202606110003_kiosk_pgcrypto_search_path.sql"), "utf8");
  const columnSecurity = readFileSync(resolve("supabase/migrations/202606110004_kiosk_pin_hash_column_security.sql"), "utf8");

  it("keeps PIN hashes private and verifies them inside security-definer functions", () => {
    expect(migration).toContain("pin_hash text");
    expect(migration).toContain("crypt(candidate_pin, settings.pin_hash)");
    expect(migration).toContain("revoke all on public.staff_kiosk_settings from anon");
    expect(migration).not.toMatch(/returns table[\\s\\S]{0,300}pin_hash/i);
    expect(pgcryptoFix).toContain("search_path = public, extensions");
    expect(columnSecurity).toContain("revoke all on public.staff_kiosk_settings from authenticated");
    expect(columnSecurity).not.toMatch(/grant select[\\s\\S]*pin_hash/i);
  });

  it("locks repeated failures and prevents invalid clock transitions", () => {
    expect(migration).toContain("failures >= 5");
    expect(migration).toContain("interval '15 minutes'");
    expect(migration).toContain("'already_clocked_in'");
    expect(migration).toContain("'not_clocked_in'");
    expect(migration).toContain("interval '5 seconds'");
  });

  it("keeps original events immutable and restricts corrections to managers", () => {
    expect(migration).toContain("Managers can add clock corrections");
    expect(migration).toContain("event_source = 'manager'");
    expect(migration).toContain("manager_correction = true");
    expect(migration).not.toMatch(/create policy [\\s\\S]* clock_events for update/i);
  });
});

describe("device-specific kiosk access", () => {
  const migration = readFileSync(resolve("supabase/migrations/202606120002_kiosk_devices_manager_access.sql"), "utf8");
  const middleware = readFileSync(resolve("middleware.ts"), "utf8");
  const kioskServer = readFileSync(resolve("src/lib/kiosk/server.ts"), "utf8");
  const kioskActions = readFileSync(resolve("src/lib/kiosk/actions.ts"), "utf8");

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
    expect(kioskServer).toContain("get_device_kiosk_roster");
    expect(kioskActions).toContain("record_device_kiosk_clock_event");
  });

  it("keeps the device token in an HttpOnly cookie and redirects manager routes", () => {
    expect(KIOSK_DEVICE_COOKIE).toBe("jan_kiosk_device");
    const deviceSession = readFileSync(resolve("src/lib/kiosk/device-session.ts"), "utf8");
    expect(deviceSession).toContain("httpOnly: true");
    expect(deviceSession).not.toContain("localStorage");
    expect(middleware).toContain('url.pathname = "/clock"');
  });

  it("does not expose payroll or compliance fields in the roster", () => {
    expect(migration).not.toMatch(/get_device_kiosk_roster[\s\S]*hourly_rate/i);
    expect(migration).not.toMatch(/get_device_kiosk_roster[\s\S]*annual_salary/i);
    expect(migration).not.toMatch(/get_device_kiosk_roster[\s\S]*dbs_/i);
  });
});

describe("manager access workflow", () => {
  const migration = readFileSync(resolve("supabase/migrations/202606120002_kiosk_devices_manager_access.sql"), "utf8");
  const linker = readFileSync(resolve("scripts/link-existing-manager.ps1"), "utf8");
  const accounts = readFileSync(resolve("src/lib/accounts/server.ts"), "utf8");

  it("records who granted and disabled access", () => {
    expect(migration).toContain("access_granted_by");
    expect(migration).toContain("disabled_by");
    expect(accounts).toContain("access_granted_by: manager.id");
    expect(accounts).toContain("disabled_by: manager.id");
  });

  it("links an Auth user to an existing profile without a password", () => {
    expect(linker).toContain("Existing canonical staff profile UUID");
    expect(linker).toContain("from auth.users");
    expect(linker).toContain("update public.staff_profiles");
    expect(linker).not.toMatch(/password/i);
  });
});

describe("kiosk PIN safety", () => {
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
    expect(kioskResultMessage("locked")).toMatch(/15 minutes/i);
  });
});
