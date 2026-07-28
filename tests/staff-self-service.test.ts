import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseWeekStart, summariseAttendanceDay } from "@/lib/staff-self-service/server";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("staff self-service", () => {
  const server = source("src/lib/staff-self-service/server.ts");

  it("loads only the signed-in staff member's published rota", () => {
    expect(server).toContain('requireAccount(["staff"])');
    expect(server).toContain('.eq("status", "published")');
    expect(server).toContain('.eq("staff_id", account.staffId)');
    expect(server).toContain('.in("status", ["scheduled", "completed"])');
  });

  it("loads attendance through the authenticated limited-return RPC", () => {
    expect(server).toContain('.rpc("get_own_attendance_records"');
    expect(server).toContain("range_start: range.from");
    expect(server).toContain("range_end: range.to");
    expect(server).not.toContain('supabase.from("clock_events")');
    expect(server).not.toContain('supabase.from("staff_profiles")');
    expect(server).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(server).not.toContain("createClient(");
  });

  it("limits the ownership-checked RPC to attendance resolver fields", () => {
    const migration = source("supabase/migrations/202607280001_clock_event_corrections.sql");
    const start = migration.indexOf("create or replace function public.get_own_attendance_records");
    const end = migration.indexOf("\n$$;", start);
    const ownAttendanceRpc = migration.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(ownAttendanceRpc).toContain("security definer");
    expect(ownAttendanceRpc).toContain("staff_account := public.current_staff_account()");
    expect(ownAttendanceRpc).toContain("correction.staff_id = staff_account.staff_id");
    expect(ownAttendanceRpc).toContain("original_event_id");
    expect(ownAttendanceRpc).toContain("supersedes_correction_id");
    expect(ownAttendanceRpc).not.toMatch(/\breason\b|created_by|hourly_rate|salary/i);
    expect(migration).toMatch(
      /grant execute on function public\.get_own_attendance_records\(date, date\)[\s\S]*?to authenticated/i,
    );
  });

  it("keeps self-service pages read-only", () => {
    const rota = source("src/components/staff-self-service/my-rota.tsx");
    const attendance = source("src/components/staff-self-service/my-attendance.tsx");
    expect(rota).not.toContain("server action");
    expect(attendance).not.toContain("action={");
    expect(attendance).toContain("Original kiosk events cannot be edited here.");
  });

  it("protects staff routes and consolidates leave navigation", () => {
    const middleware = source("middleware.ts");
    const leave = source("src/components/leave/leave-navigation.tsx");
    expect(middleware).toContain('"/my-rota"');
    expect(middleware).toContain('"/my-attendance"');
    expect(leave).toContain("My requests");
    expect(leave).toContain("Request leave");
    expect(leave).toContain("Review requests");
  });

  it("retains database-level cross-staff restrictions", () => {
    const rotaMigration = source("supabase/migrations/202606120003_production_rota.sql");
    const attendanceMigration = source("supabase/migrations/202606110002_production_kiosk_attendance.sql");
    expect(rotaMigration).toContain("Staff can read own published shifts");
    expect(rotaMigration).toContain("rw.status = 'published'");
    expect(attendanceMigration).toContain("Staff can read own clock events");
    expect(attendanceMigration).toContain("staff_id = public.current_staff_profile_id()");
  });

  it("uses Monday week starts", () => {
    expect(normaliseWeekStart("2026-06-14")).toBe("2026-06-08");
    expect(normaliseWeekStart("2026-06-15")).toBe("2026-06-15");
  });

  it("pairs clock events without changing the originals", () => {
    const day = summariseAttendanceDay("2026-06-13", [
      { id: "in", eventType: "clock_in", eventTimestamp: "2026-06-13T08:00:00+01:00", managerCorrection: false },
      { id: "out", eventType: "clock_out", eventTimestamp: "2026-06-13T16:30:00+01:00", managerCorrection: true },
    ], [
      { id: "original-in", eventType: "clock_in", eventTimestamp: "2026-06-13T07:45:00+01:00", managerCorrection: false },
      { id: "original-out", eventType: "clock_out", eventTimestamp: "2026-06-13T16:30:00+01:00", managerCorrection: false },
    ], [
      { id: "in", eventType: "clock_in", eventTimestamp: "2026-06-13T08:00:00+01:00", sourceLabel: "Manager correction", status: "active" },
    ]);
    expect(day.totalMinutes).toBe(510);
    expect(day.missingClockOut).toBe(false);
    expect(day.hasManagerCorrection).toBe(true);
    expect(day.events).toHaveLength(2);
    expect(day.originalEvents).toHaveLength(2);
    expect(day.corrections).toEqual([
      { id: "in", eventType: "clock_in", eventTimestamp: "2026-06-13T08:00:00+01:00", sourceLabel: "Manager correction", status: "active" },
    ]);
  });

  it("uses effective lineage ordering when self-service events share an instant", () => {
    const events = [
      {
        id: "f0000000-0000-0000-0000-000000000000",
        orderKey: "10000000-0000-0000-0000-000000000000",
        eventType: "clock_in" as const,
        eventTimestamp: "2026-06-13T08:00:00+01:00",
        managerCorrection: true,
      },
      {
        id: "20000000-0000-0000-0000-000000000000",
        orderKey: "20000000-0000-0000-0000-000000000000",
        eventType: "clock_out" as const,
        eventTimestamp: "2026-06-13T08:00:00+01:00",
        managerCorrection: false,
      },
    ];

    const day = summariseAttendanceDay("2026-06-13", events);

    expect(day.totalMinutes).toBe(0);
    expect(day.missingClockOut).toBe(false);
  });
});
