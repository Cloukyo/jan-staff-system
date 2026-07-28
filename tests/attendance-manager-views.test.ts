import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as attendanceViews from "@/components/attendance/production-attendance";
import { attendanceViewHref } from "@/components/attendance/attendance-page-nav";
import { parseAttendanceManagerView, parseAttendancePageSearchParams } from "@/lib/attendance/manager-view";
import { attendanceDayHref } from "@/lib/attendance/day-route";
import { parseStaffHoursWeekId, toStaffHoursWeek, type StaffHoursRange } from "@/lib/attendance/staff-hours";
import type { AttendanceReviewRow } from "@/lib/attendance/review-server";
import * as kioskServer from "@/lib/kiosk/server";
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
    recordType: "original",
    eventType: index % 2 === 0 ? "clock_in" : "clock_out",
    eventTimestamp: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T08:00:00.000Z`,
    recordedDate: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
    eventSource: "kiosk",
    managerCorrection: false,
    correctionReason: null,
    auditStatus: "active",
    correctionKind: null,
    originalEventId: null,
    supersedesCorrectionId: null,
    createdAt: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T08:00:00.000Z`,
    createdByName: null,
    ...overrides,
  };
}

describe("manager attendance views", () => {
  it("adds and removes the expanded day without losing the staff-week route", () => {
    const route = "view=hours&hoursFrom=2026-07-27&hoursTo=2026-08-02&staffId=staff-1";

    expect(attendanceDayHref(route, "2026-07-28", true)).toBe(
      "/attendance?view=hours&hoursFrom=2026-07-27&hoursTo=2026-08-02&staffId=staff-1&day=2026-07-28",
    );
    expect(attendanceDayHref(`${route}&day=2026-07-28`, "2026-07-28", false)).toBe(
      "/attendance?view=hours&hoursFrom=2026-07-27&hoursTo=2026-08-02&staffId=staff-1",
    );
    expect(attendanceDayHref(`${route}&day=2026-07-29`, "2026-07-28", false)).toBe(
      "/attendance?view=hours&hoursFrom=2026-07-27&hoursTo=2026-08-02&staffId=staff-1&day=2026-07-29",
    );
  });

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
      "staff-3",
    ]);
  });

  it("loads Today from the current London review date, not the requested review date", () => {
    const attendancePage = readFileSync(
      resolve("src/app/attendance/page.tsx"),
      "utf8",
    );

    expect(attendancePage).toContain('view === "today"');
    expect(attendancePage).toContain("loadAttendanceReviewDay(isoDateInLondon())");
    expect(attendancePage).toContain(
      '<AttendanceToday staff={dataset.staff} rows={review.rows} />',
    );
  });

  it("supports the Yesterday and Staff hours attendance views", () => {
    const attendancePage = readFileSync(
      resolve("src/app/attendance/page.tsx"),
      "utf8",
    );

    expect(parseAttendanceManagerView("yesterday")).toBe("yesterday");
    expect(parseAttendanceManagerView("hours")).toBe("hours");
    expect(attendancePage).toContain("loadAttendanceDay(yesterdayDate)");
    expect(attendancePage).toContain("loadStaffHoursList(hoursFrom, hoursTo)");
    expect(attendancePage).toContain("loadStaffHoursWeek(staffId, hoursFrom, hoursTo)");
    expect(attendancePage).toContain('<StaffHoursList data={staffHoursList} />');
    expect(attendancePage).toContain('<StaffHoursTimeline data={staffHoursWeek}');
  });

  it("keeps Yesterday on the London previous-date route when an hours deep link has expansion state", () => {
    const attendancePage = readFileSync(resolve("src/app/attendance/page.tsx"), "utf8");

    expect(attendanceViewHref("yesterday", {
      day: "not-a-date",
      staffId: "stale-staff-id",
      hoursFrom: "2026-07-20",
      hoursTo: "2026-07-26",
    })).toBe("/attendance?view=yesterday");
    expect(attendancePage).toContain("const yesterdayDate = previousLondonDate();");
    expect(attendancePage).not.toContain("day ?? previousLondonDate()");

    expect(attendanceViewHref("hours", {
      day: "2026-07-22",
      staffId: "staff-1",
      hoursFrom: "2026-07-20",
      hoursTo: "2026-07-26",
    })).toContain("day=2026-07-22");
  });

  it("renders a staff-hours not-found state when the selected staff member is no longer active", () => {
    const emptyRange: StaffHoursRange = {
      from: "2026-07-20",
      to: "2026-07-26",
      currentWeekStart: "2026-07-20",
      currentWeekEnd: "2026-07-26",
      staff: [],
      days: [],
    };
    const attendancePage = readFileSync(resolve("src/app/attendance/page.tsx"), "utf8");

    expect(toStaffHoursWeek(emptyRange)).toBeNull();
    expect(parseStaffHoursWeekId(" stf-001 ")).toBe("stf-001");
    expect(parseStaffHoursWeekId("")).toBeNull();
    expect(parseStaffHoursWeekId("   ")).toBeNull();
    expect(parseStaffHoursWeekId("bad/staff id")).toBeNull();
    expect(parseStaffHoursWeekId("s".repeat(129))).toBeNull();
    expect(attendancePage).toContain("<StaffHoursNotFound");
    expect(attendancePage).toContain("!staffHoursWeek");
    expect(readFileSync(resolve("src/components/attendance/staff-hours-timeline.tsx"), "utf8"))
      .toContain("Back to Staff hours");
  });

  it("parses Staff hours query values without confusing a missing staff ID with malformed input", () => {
    const attendancePage = readFileSync(resolve("src/app/attendance/page.tsx"), "utf8");

    expect(parseAttendancePageSearchParams({ view: "hours" })).toMatchObject({
      view: "hours",
      staffId: undefined,
      staffIdProvided: false,
    });
    expect(parseAttendancePageSearchParams({ view: "hours", staffId: "" })).toMatchObject({
      staffId: "",
      staffIdProvided: true,
    });
    expect(parseAttendancePageSearchParams({ view: "hours", staffId: "stf-001" })).toMatchObject({
      staffId: "stf-001",
      staffIdProvided: true,
    });
    expect(parseAttendancePageSearchParams({
      view: "hours",
      staffId: ["stf-001", "stf-002"],
      day: ["2026-07-20", "2026-07-21"],
      hoursFrom: ["2026-07-20"],
      hoursTo: ["2026-07-26"],
    })).toMatchObject({
      staffId: undefined,
      staffIdProvided: true,
      day: undefined,
      hoursFrom: undefined,
      hoursTo: undefined,
    });

    const malformed = parseAttendancePageSearchParams({ view: "hours", staffId: "bad/staff id" });
    const overlong = parseAttendancePageSearchParams({ view: "hours", staffId: "s".repeat(129) });
    expect(parseStaffHoursWeekId(malformed.staffId)).toBeNull();
    expect(parseStaffHoursWeekId(overlong.staffId)).toBeNull();
    expect(attendancePage).toContain("!staffIdProvided");
    expect(attendancePage).toContain("staffIdProvided && !staffHoursWeek");
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
      {
        ...clockEvent(3),
        id: "superseded-correction",
        staffId: "staff-1",
        recordType: "correction",
        eventType: null,
        eventTimestamp: null,
        eventSource: "manager_correction",
        managerCorrection: true,
        correctionReason: "Duplicate kiosk tap",
        auditStatus: "superseded",
        correctionKind: "exclude",
        originalEventId: "event-3",
        supersedesCorrectionId: "older-correction",
        createdAt: "2026-07-28T10:00:00Z",
        createdByName: "Manager Account",
      } as unknown as ManagerClockEvent,
    ];

    for (const query of ["Rehana", "clock out", "forgot", "27/07/2026"]) {
      expect(
        filterAndPaginateAttendanceHistory(staff, events, query, 1).events.map(
          (event) => event.id,
        ),
      ).toEqual(["corrected"]);
    }

    for (const query of ["superseded", "exclude", "duplicate", "Manager Account", "04/07/2026"]) {
      expect(
        filterAndPaginateAttendanceHistory(staff, events, query, 1).events.map(
          (event) => event.id,
        ),
      ).toEqual(["superseded-correction"]);
    }

    const loader = readFileSync(resolve("src/lib/kiosk/server.ts"), "utf8");
    expect(loader).toContain('from("clock_event_corrections")');
    expect(loader).toContain("created_by");
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

  it("loads every history page before resolving correction ancestry", async () => {
    const loadManagerClockHistorySources = (
      kioskServer as unknown as {
        loadManagerClockHistorySources?: (
          loadOriginalPage: (from: number, to: number) => Promise<{
            data: Array<Record<string, unknown>>;
            error: null;
          }>,
          loadCorrectionPage: (from: number, to: number) => Promise<{
            data: Array<Record<string, unknown>>;
            error: null;
          }>,
          pageSize?: number,
        ) => Promise<{
          originalRows: Array<Record<string, unknown>>;
          correctionRows: Array<Record<string, unknown>>;
        }>;
      }
    ).loadManagerClockHistorySources;
    expect(typeof loadManagerClockHistorySources).toBe("function");

    const originalRows = Array.from({ length: 251 }, (_, index) => ({
      id: `original-${index}`,
      staff_id: "staff-1",
      event_type: index % 2 === 0 ? "clock_in" : "clock_out",
      event_timestamp: `2026-07-28T${String(8 + (index % 10)).padStart(2, "0")}:00:00.000Z`,
      recorded_date: "2026-07-28",
      event_source: "kiosk",
      manager_correction: false,
      correction_reason: null,
      created_at: `2026-07-28T${String(8 + (index % 10)).padStart(2, "0")}:00:00.000Z`,
    }));
    const correctionRows = [
      {
        id: "leaf-correction",
        staff_id: "staff-1",
        correction_kind: "replace",
        original_event_id: null,
        supersedes_correction_id: "root-correction",
        event_type: "clock_in",
        event_timestamp: "2026-07-28T08:30:00.000Z",
        recorded_date: "2026-07-28",
        reason: "Final corrected time",
        created_by: "manager-1",
        created_at: "2026-07-28T11:00:00.000Z",
      },
      ...Array.from({ length: 249 }, (_, index) => ({
        id: `filler-correction-${index}`,
        staff_id: "staff-1",
        correction_kind: "add",
        original_event_id: null,
        supersedes_correction_id: null,
        event_type: index % 2 === 0 ? "clock_in" : "clock_out",
        event_timestamp: `2026-07-28T${String(9 + (index % 8)).padStart(2, "0")}:30:00.000Z`,
        recorded_date: "2026-07-28",
        reason: "Complete paged history",
        created_by: "manager-1",
        created_at: `2026-07-28T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
      })),
      {
        id: "root-correction",
        staff_id: "staff-1",
        correction_kind: "replace",
        original_event_id: "original-0",
        supersedes_correction_id: null,
        event_type: "clock_out",
        event_timestamp: "2026-07-28T08:15:00.000Z",
        recorded_date: "2026-07-28",
        reason: "Initial corrected time",
        created_by: "manager-1",
        created_at: "2026-07-28T09:00:00.000Z",
      },
    ];
    const originalPageCalls: Array<[number, number]> = [];
    const correctionPageCalls: Array<[number, number]> = [];
    const loaded = await loadManagerClockHistorySources!(
      async (from, to) => {
        originalPageCalls.push([from, to]);
        return { data: originalRows.slice(from, to + 1), error: null };
      },
      async (from, to) => {
        correctionPageCalls.push([from, to]);
        return { data: correctionRows.slice(from, to + 1), error: null };
      },
      250,
    );
    const history = kioskServer.buildManagerClockHistory(
      loaded.originalRows as never[],
      loaded.correctionRows as never[],
      new Map([["manager-1", "Manager Account"]]),
    );

    expect(originalPageCalls).toEqual([[0, 249], [250, 499]]);
    expect(correctionPageCalls).toEqual([[0, 249], [250, 499]]);
    expect(history).toHaveLength(502);
    expect(history.find((row) => row.id === "original-0")?.auditStatus).toBe("replaced");
    expect(history.find((row) => row.id === "root-correction")?.auditStatus).toBe("superseded");
    expect(history.find((row) => row.id === "leaf-correction")?.auditStatus).toBe("active");
  });
});
