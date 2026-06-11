import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { kioskRepositorySource, mapKioskRoster } from "@/lib/kiosk/server";
import { kioskResultMessage, validateKioskPin } from "@/lib/kiosk/security";

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
