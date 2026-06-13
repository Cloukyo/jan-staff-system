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

  it("loads only the signed-in staff member's clock events", () => {
    expect(server).toContain('supabase.from("clock_events")');
    expect(server).toContain('.eq("staff_id", account.staffId)');
    expect(server).not.toContain('supabase.from("staff_profiles")');
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
    ]);
    expect(day.totalMinutes).toBe(510);
    expect(day.missingClockOut).toBe(false);
    expect(day.hasManagerCorrection).toBe(true);
    expect(day.events).toHaveLength(2);
  });
});
