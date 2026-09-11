import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  certificateTimingStatus,
  personalRotaSummary,
  staffAttendanceStatus,
} from "@/lib/staff-self-service/presentation";

describe("staff self-service presentation", () => {
  it("prioritises today's and the next upcoming shift", () => {
    const summary = personalRotaSummary({
      weekStart: "2026-09-07",
      weekEnd: "2026-09-13",
      publishedAt: "2026-09-04T10:00:00Z",
      shifts: [
        { id: "past", shiftDate: "2026-09-08", startTime: "08:00", endTime: "16:00", breakMinutes: 30, breakUnspecified: false, workArea: "Blue room", roomOrArea: "Blue room", roleOnShift: null, status: "completed" },
        { id: "today", shiftDate: "2026-09-11", startTime: "09:00", endTime: "17:00", breakMinutes: 30, breakUnspecified: false, workArea: "Garden", roomOrArea: "Garden", roleOnShift: null, status: "scheduled" },
        { id: "next", shiftDate: "2026-09-12", startTime: "08:30", endTime: "13:00", breakMinutes: 0, breakUnspecified: false, workArea: null, roomOrArea: null, roleOnShift: null, status: "scheduled" },
      ],
      leave: [],
    }, "2026-09-11");

    expect(summary.today.map((shift) => shift.id)).toEqual(["today"]);
    expect(summary.next?.id).toBe("next");
    expect(summary.upcoming.map((shift) => shift.id)).toEqual(["today", "next"]);
  });

  it("uses personal attendance states without exposing manager workflow terms", () => {
    expect(staffAttendanceStatus({ missingClockOut: true, hasManagerCorrection: false })).toEqual({
      label: "Needs attention",
      tone: "amber",
      explanation: "A clock-out is missing. Tell your manager if this needs correcting.",
    });
    expect(staffAttendanceStatus({ missingClockOut: false, hasManagerCorrection: true }).label).toBe("Corrected");
    expect(staffAttendanceStatus({ missingClockOut: false, hasManagerCorrection: false }).label).toBe("Recorded");
  });

  it("distinguishes current, due-soon, expired and no-expiry training", () => {
    expect(certificateTimingStatus("2026-12-01", "2026-09-11").key).toBe("current");
    expect(certificateTimingStatus("2026-10-01", "2026-09-11").key).toBe("due_soon");
    expect(certificateTimingStatus("2026-09-01", "2026-09-11").key).toBe("expired");
    expect(certificateTimingStatus(null, "2026-09-11").key).toBe("no_expiry");
  });
});

describe("staff self-service surface", () => {
  const shell = readFileSync(resolve("src/components/layout/app-shell.tsx"), "utf8");
  const rota = readFileSync(resolve("src/components/staff-self-service/my-rota.tsx"), "utf8");
  const attendance = readFileSync(resolve("src/components/staff-self-service/my-attendance.tsx"), "utf8");
  const profile = readFileSync(resolve("src/components/profile/production-profile.tsx"), "utf8");

  it("offers five personal destinations and keeps leave requests inside My leave", () => {
    expect(shell).toContain('label: "My rota"');
    expect(shell).toContain('label: "My attendance"');
    expect(shell).toContain('label: "My leave"');
    expect(shell).toContain('label: "My profile"');
    expect(shell).toContain('label: "Qualifications & training"');
    expect(shell).not.toContain('label: "Request leave"');
  });

  it("removes implementation labels and gives each page a personal hierarchy", () => {
    for (const source of [rota, attendance, profile]) {
      expect(source).not.toContain("Production data | Supabase");
    }
    expect(rota).toContain("Today");
    expect(rota).toContain("Next shift");
    expect(attendance).toContain("Attendance needing attention");
    expect(profile).toContain('id="qualifications-training"');
  });
});
