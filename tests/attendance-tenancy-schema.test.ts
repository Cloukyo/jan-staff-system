// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function attendanceTenancyMigration(): string {
  const name = readdirSync(resolve("supabase/migrations"))
    .find((entry) => entry.endsWith("_attendance_tenancy.sql"));
  if (!name) throw new Error("attendance tenancy migration is missing");
  return readFileSync(resolve("supabase/migrations", name), "utf8");
}

describe("attendance tenancy migration contract", () => {
  it("expands every attendance owner and the minimum kiosk boundary", () => {
    const sql = attendanceTenancyMigration();
    for (const table of [
      "clock_events",
      "clock_event_corrections",
      "attendance_day_reviews",
      "attendance_correction_requests",
      "attendance_operation_requests",
      "attendance_action_requests",
      "attendance_exceptions",
      "attendance_exception_operations",
      "kiosk_devices",
    ]) {
      expect(sql).toContain(`alter table public.${table}`);
    }
    expect(sql).toContain("organisation_id uuid");
    expect(sql).toContain("site_id uuid");
  });

  it("declares tenant-aware locks, ledger, state and command boundaries", () => {
    const sql = attendanceTenancyMigration();
    expect(sql).toContain("private.lock_attendance_stream");
    expect(sql).toContain("public.get_commercial_effective_clock_events");
    expect(sql).toContain("public.get_commercial_attendance_state");
    expect(sql).toContain("public.perform_commercial_kiosk_attendance_action");
    expect(sql).toContain("public.save_commercial_clock_event_correction");
  });

  it("keeps commercial attendance RPCs narrowly granted", () => {
    const sql = attendanceTenancyMigration();
    expect(sql).toMatch(/revoke all on function public\.perform_commercial_kiosk_attendance_action[\s\S]+from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.perform_commercial_kiosk_attendance_action[\s\S]+to anon, authenticated/i);
    expect(sql).not.toMatch(/grant (?:insert|update|delete)[^;]+clock_events[^;]+authenticated/i);
  });
});
