import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  leaveDecisionConfirmation,
  leaveStatusCounts,
  orderLeaveRequests,
} from "@/lib/leave/presentation";
import type { LeaveRequest } from "@/types";

function request(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: "leave-1",
    staffId: "staff-1",
    leaveType: "annual_leave",
    startDate: "2026-09-14",
    endDate: "2026-09-16",
    dayPart: "full_day",
    startTime: null,
    endTime: null,
    requestedMinutes: 1_440,
    staffNote: "Family holiday",
    status: "pending",
    managerNote: null,
    reviewedBy: null,
    reviewedAt: null,
    cancelledAt: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    revision: 1,
    ...overrides,
  };
}

describe("leave UX presentation", () => {
  it("counts pending work separately from decision history", () => {
    expect(leaveStatusCounts([
      request(),
      request({ id: "leave-2", status: "approved" }),
      request({ id: "leave-3", status: "approved" }),
      request({ id: "leave-4", status: "rejected" }),
    ])).toEqual({ pending: 1, approved: 2, rejected: 1, cancelled: 0, all: 4 });
  });

  it("orders pending decisions before history and newest requests first", () => {
    const ordered = orderLeaveRequests([
      request({ id: "approved", status: "approved", createdAt: "2026-09-10T09:00:00.000Z" }),
      request({ id: "older", createdAt: "2026-09-01T09:00:00.000Z" }),
      request({ id: "newer", createdAt: "2026-09-05T09:00:00.000Z" }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["newer", "older", "approved"]);
  });

  it("states the exact decision scope and rota consequence", () => {
    expect(leaveDecisionConfirmation(request(), "Alex Example", "approved"))
      .toBe("Approve annual leave for Alex Example from 14 September 2026 to 16 September 2026 (24 hours)? Existing rota shifts in this period will need review.");
    expect(leaveDecisionConfirmation(request(), "Alex Example", "rejected"))
      .toBe("Reject annual leave for Alex Example from 14 September 2026 to 16 September 2026 (24 hours)? The request will remain in leave history.");
  });

  it("uses one manager note and explicit consequential confirmations", () => {
    const screen = readFileSync(resolve("src/components/leave/production-leave.tsx"), "utf8");
    const actionForm = readFileSync(resolve("src/components/compliance/production-action-form.tsx"), "utf8");

    expect(screen).toContain("Requests needing a decision");
    expect(screen).toContain('aria-label="Filter leave requests"');
    expect(screen).toContain("managerNotes");
    expect(screen).toContain('type="hidden" name="managerNote"');
    expect(screen).toContain("leaveDecisionConfirmation");
    expect(actionForm).toContain("confirmMessage");
  });
});
