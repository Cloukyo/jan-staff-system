import { describe, expect, it } from "vitest";
import * as attendanceViews from "@/components/attendance/production-attendance";
import type { AttendanceReviewRow } from "@/lib/attendance/review-server";
import type { ManagerClockEvent, ManagerKioskRow } from "@/lib/kiosk/server";

function reviewRow(
  overrides: Partial<AttendanceReviewRow>,
): AttendanceReviewRow {
  return {
    staffId: "staff-1",
    fullName: "Aisha Khan",
    scheduledStart: null,
    scheduledEnd: null,
    firstClockIn: null,
    finalClockOut: null,
    recordedMinutes: 0,
    exceptions: [],
    managerCorrection: false,
    reviewStatus: "unreviewed",
    reviewReason: null,
    reviewedAt: null,
    pendingClarificationCount: 0,
    pendingClarifications: [],
    ...overrides,
  };
}

function rosterRow(
  staffId: string,
  displayName: string,
  currentStatus: ManagerKioskRow["currentStatus"],
): ManagerKioskRow {
  return {
    staffId,
    displayName,
    fullName: displayName,
    employmentRole: "Nursery practitioner",
    currentStatus,
    pinReady: true,
    kioskEnabled: true,
    pinUpdatedAt: "2026-07-01T09:00:00.000Z",
    pinResetRequired: false,
    failedAttemptCount: 0,
    lockedUntil: null,
    lastKioskUseAt: null,
  };
}

function clockEvent(
  index: number,
  overrides: Partial<ManagerClockEvent> = {},
): ManagerClockEvent {
  return {
    id: `event-${index}`,
    staffId: "staff-1",
    eventType: index % 2 === 0 ? "clock_in" : "clock_out",
    eventTimestamp: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T08:00:00.000Z`,
    recordedDate: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
    eventSource: "kiosk",
    managerCorrection: false,
    correctionReason: null,
    ...overrides,
  };
}

describe("manager attendance views", () => {
  it("groups current staff, scheduled no-shows and missing clock-outs", () => {
    const buildAttendanceTodayGroups = (
      attendanceViews as unknown as {
        buildAttendanceTodayGroups: (
          staff: ManagerKioskRow[],
          rows: AttendanceReviewRow[],
        ) => {
          clockedIn: ManagerKioskRow[];
          scheduledNotClockedIn: AttendanceReviewRow[];
          missingClockOuts: AttendanceReviewRow[];
        };
      }
    ).buildAttendanceTodayGroups;
    expect(typeof buildAttendanceTodayGroups).toBe("function");

    const groups = buildAttendanceTodayGroups(
      [
        rosterRow("staff-1", "Aisha", "clocked_in"),
        rosterRow("staff-2", "Rehana", "clocked_out"),
        rosterRow("staff-3", "Mina", "clocked_out"),
      ],
      [
        reviewRow({
          staffId: "staff-1",
          fullName: "Aisha Khan",
          firstClockIn: "2026-07-27T08:00:00.000Z",
        }),
        reviewRow({
          staffId: "staff-2",
          fullName: "Rehana Ali",
          scheduledStart: "09:00",
          scheduledEnd: "17:00",
        }),
        reviewRow({
          staffId: "staff-3",
          fullName: "Mina Shah",
          firstClockIn: "2026-07-27T08:30:00.000Z",
          exceptions: ["Missing clock-out"],
        }),
      ],
    );

    expect(groups.clockedIn.map((row) => row.staffId)).toEqual(["staff-1"]);
    expect(groups.scheduledNotClockedIn.map((row) => row.staffId)).toEqual([
      "staff-2",
    ]);
    expect(groups.missingClockOuts.map((row) => row.staffId)).toEqual([
      "staff-1",
      "staff-3",
    ]);
  });

  it("searches immutable history by staff, event, source, reason and date", () => {
    const filterAndPaginateAttendanceHistory = (
      attendanceViews as unknown as {
        filterAndPaginateAttendanceHistory: (
          staff: ManagerKioskRow[],
          events: ManagerClockEvent[],
          query: string,
          page: number,
          pageSize?: number,
        ) => { events: ManagerClockEvent[]; totalItems: number };
      }
    ).filterAndPaginateAttendanceHistory;
    expect(typeof filterAndPaginateAttendanceHistory).toBe("function");

    const staff = [
      rosterRow("staff-1", "Aisha Khan", "clocked_out"),
      rosterRow("staff-2", "Rehana Ali", "clocked_out"),
    ];
    const events = [
      clockEvent(0),
      clockEvent(2, {
        id: "corrected",
        staffId: "staff-2",
        eventType: "clock_out",
        recordedDate: "2026-07-27",
        eventTimestamp: "2026-07-27T17:15:00.000Z",
        eventSource: "manager",
        managerCorrection: true,
        correctionReason: "Forgot to clock out",
      }),
    ];

    for (const query of [
      "Rehana",
      "clock out",
      "manager correction",
      "forgot",
      "27/07/2026",
    ]) {
      expect(
        filterAndPaginateAttendanceHistory(staff, events, query, 1).events.map(
          (event) => event.id,
        ),
      ).toEqual(["corrected"]);
    }
  });

  it("paginates history in stable 25-row pages and clamps invalid pages", () => {
    const filterAndPaginateAttendanceHistory = (
      attendanceViews as unknown as {
        filterAndPaginateAttendanceHistory: (
          staff: ManagerKioskRow[],
          events: ManagerClockEvent[],
          query: string,
          page: number,
          pageSize?: number,
        ) => {
          events: ManagerClockEvent[];
          page: number;
          totalPages: number;
          totalItems: number;
        };
      }
    ).filterAndPaginateAttendanceHistory;
    expect(typeof filterAndPaginateAttendanceHistory).toBe("function");

    const events = Array.from({ length: 52 }, (_, index) => clockEvent(index));
    const result = filterAndPaginateAttendanceHistory(
      [rosterRow("staff-1", "Aisha Khan", "clocked_out")],
      events,
      "",
      2,
    );

    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(3);
    expect(result.totalItems).toBe(52);
    expect(result.events.map((event) => event.id)).toEqual(
      events.slice(25, 50).map((event) => event.id),
    );
    expect(
      filterAndPaginateAttendanceHistory([], events, "", 99).page,
    ).toBe(3);
  });
});
