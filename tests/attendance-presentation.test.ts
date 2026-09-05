import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AttendanceReview } from "@/components/attendance/attendance-review";
import {
  buildAttendanceActionQueue,
  classifyAttendanceReviewRow,
} from "@/components/attendance/attendance-presentation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

type TestRow = Parameters<typeof classifyAttendanceReviewRow>[0];

function row(overrides: Partial<TestRow> = {}): TestRow {
  return {
    staffId: "staff-1",
    reviewStatus: "unreviewed",
    exceptions: [],
    pendingClarificationCount: 0,
    ...overrides,
  };
}

describe("attendance action presentation", () => {
  it("distinguishes correction, follow-up, review and completed records", () => {
    expect(classifyAttendanceReviewRow(row({ exceptions: ["Missing clock-out"] }))).toMatchObject({
      kind: "correction",
      tone: "blocking",
      label: "Fix recorded time",
    });
    expect(classifyAttendanceReviewRow(row({
      reviewStatus: "needs_staff_clarification",
      pendingClarificationCount: 1,
    }))).toMatchObject({
      kind: "follow_up",
      tone: "attention",
      label: "Staff follow-up needed",
    });
    expect(classifyAttendanceReviewRow(row())).toMatchObject({
      kind: "review",
      tone: "attention",
      label: "Ready for review",
    });
    expect(classifyAttendanceReviewRow(row({ reviewStatus: "approved" }))).toMatchObject({
      kind: "complete",
      tone: "success",
      label: "Reviewed",
    });
  });

  it("prioritises correction and follow-up while retaining stable order", () => {
    const rows = [
      row({ staffId: "complete", reviewStatus: "approved" }),
      row({ staffId: "review-1" }),
      row({ staffId: "correction-1", exceptions: ["Missing clock-in"] }),
      row({ staffId: "follow-up", pendingClarificationCount: 2 }),
      row({ staffId: "correction-2", exceptions: ["Missing clock-out"] }),
      row({ staffId: "review-2" }),
    ];

    const queue = buildAttendanceActionQueue(rows);

    expect(queue.rows.map(({ row: item }) => item.staffId)).toEqual([
      "correction-1",
      "correction-2",
      "follow-up",
      "review-1",
      "review-2",
      "complete",
    ]);
    expect(queue.counts).toEqual({
      correction: 2,
      followUp: 1,
      review: 2,
      complete: 1,
      actionRequired: 5,
      total: 6,
    });
  });

  it("treats an exception as the primary action even when staff follow-up also exists", () => {
    expect(classifyAttendanceReviewRow(row({
      exceptions: ["Missing clock-out"],
      pendingClarificationCount: 1,
    })).kind).toBe("correction");
  });

  it("renders an action-first review summary and keeps completed records available", () => {
    const html = renderToStaticMarkup(createElement(AttendanceReview, {
      data: {
        date: "2026-09-04",
        counts: {
          scheduled: 3,
          clockedIn: 3,
          exceptions: 1,
          unreviewed: 1,
          clarificationRequests: 0,
        },
        rows: [
          {
            ...row({ staffId: "needs-fix", exceptions: ["Missing clock-out"] }),
            fullName: "Jamie Example",
            scheduledStart: "09:00",
            scheduledEnd: "17:00",
            firstClockIn: "2026-09-04T09:00:00+01:00",
            finalClockOut: null,
            recordedMinutes: 0,
            managerCorrection: false,
            reviewReason: null,
            reviewedAt: null,
            pendingClarifications: [],
          },
          {
            ...row({ staffId: "reviewed", reviewStatus: "approved" }),
            fullName: "Morgan Example",
            scheduledStart: "09:00",
            scheduledEnd: "17:00",
            firstClockIn: "2026-09-04T09:00:00+01:00",
            finalClockOut: "2026-09-04T17:00:00+01:00",
            recordedMinutes: 480,
            managerCorrection: false,
            reviewReason: null,
            reviewedAt: "2026-09-04T17:15:00+01:00",
            pendingClarifications: [],
          },
        ],
      },
    }));

    expect(html).toContain("1 record needs attention");
    expect(html).toContain("Fix recorded time");
    expect(html).toContain("Completed records (1)");
    expect(html).toContain("Change review date");
  });
});
