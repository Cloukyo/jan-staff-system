import { describe, expect, it } from "vitest";
import { mapKioskActionResponse } from "@/lib/kiosk/rpc-mapping";
import { kioskActionPresentation } from "@/lib/kiosk/presentation";
import type { AttendanceStateResult } from "@/lib/attendance/types";
import {
  initialKioskFlowState,
  kioskFlowReducer,
} from "@/lib/kiosk/flow";

function attendanceState(
  overrides: Partial<AttendanceStateResult> = {},
): AttendanceStateResult {
  return {
    state: "clocked_out",
    operationalDate: "2026-08-03",
    currentEvent: null,
    unresolvedExceptions: [],
    allowedActions: ["clock_in"],
    warnings: [],
    revision: "revision-safe-value",
    evaluatedAt: "2026-08-03T09:00:00+01:00",
    ...overrides,
  };
}

describe("kiosk attendance presentation", () => {
  it("offers an explicit new shift when yesterday has no clock-out", () => {
    const view = kioskActionPresentation(attendanceState({
      state: "missing_clock_out",
      allowedActions: ["start_new_shift"],
    }), "2026-08-03T09:00:00+01:00");

    expect(view.primaryLabel).toBe("Start today's shift");
    expect(view.heading).toMatch(/previous shift/i);
  });

  it("shows the original current-day clock-in time and only clock-out", () => {
    const view = kioskActionPresentation(attendanceState({
      state: "clocked_in",
      allowedActions: ["clock_out"],
      currentEvent: {
        eventId: "private-event-id",
        eventOrderKey: "private-order-key",
        originalEventId: "private-original-id",
        correctionId: null,
        staffId: "private-staff-id",
        eventType: "clock_in",
        eventTimestamp: "2026-08-03T08:17:00+01:00",
        source: "kiosk",
      },
    }), "2026-08-03T09:00:00+01:00");

    expect(view.body).toContain("08:17");
    expect(view.primaryLabel).toBe("Clock out");
  });

  it("keeps older issues as a warning without replacing today's valid state", () => {
    const view = kioskActionPresentation(attendanceState({
      state: "clocked_in",
      allowedActions: ["clock_out"],
      currentEvent: {
        eventId: "event-today",
        eventOrderKey: "event-today:original",
        originalEventId: null,
        correctionId: null,
        staffId: "staff-a",
        eventType: "clock_in",
        eventTimestamp: "2026-08-03T08:30:00+01:00",
        source: "kiosk",
      },
      unresolvedExceptions: [{
        id: "private-exception-id",
        staffId: "staff-a",
        operationalDate: "2026-08-01",
        type: "missing_clock_out",
        status: "open",
      }],
    }), "2026-08-03T09:00:00+01:00");

    expect(view.primaryLabel).toBe("Clock out");
    expect(view.body).toMatch(/manager.*earlier/i);
  });

  it("never exposes pay, hashes, SQL details or internal identifiers", () => {
    const text = JSON.stringify(kioskActionPresentation(attendanceState({
      state: "awaiting_manager_review",
      allowedActions: [],
      revision: "private-hash-value",
    }), "2026-08-03T09:00:00+01:00"));

    expect(text).not.toMatch(/pay|salary|hash|sql|private-|revision|event[_ -]?id/i);
  });
});

describe("kiosk attendance RPC mapping", () => {
  it("preserves the latest state and actions after a state conflict", () => {
    const latest = attendanceState({
      state: "clocked_in",
      allowedActions: ["clock_out"],
    });
    const result = mapKioskActionResponse({
      ok: false,
      code: "state_conflict",
      state: "clocked_in",
      attendanceState: latest,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("state_conflict");
    expect(result.attendanceState).toEqual(latest);
    expect(result.attendanceState?.allowedActions).toEqual(["clock_out"]);
  });
});

describe("kiosk confirmation flow", () => {
  it.each(["invalid", "cancel", "timeout"] as const)(
    "clears the PIN after %s",
    (reason) => {
      const started = { ...initialKioskFlowState, mode: "confirm" as const, pin: "4826" };
      const result = kioskFlowReducer(started, { type: reason });
      expect(result.pin).toBe("");
    },
  );

  it("clears the PIN after success", () => {
    const started = { ...initialKioskFlowState, mode: "confirm" as const, pin: "4826" };
    const result = kioskFlowReducer(started, {
      type: "succeeded",
      recordedAt: "2026-08-03T17:05:00+01:00",
      completedMinutes: 485,
    });
    expect(result.pin).toBe("");
    expect(result.mode).toBe("success");
    expect(result.recordedAt).toBe("2026-08-03T17:05:00+01:00");
    expect(result.completedMinutes).toBe(485);
  });

  it("does not replace a pending submission key on a double tap", () => {
    const first = kioskFlowReducer(
      { ...initialKioskFlowState, mode: "confirm", pin: "4826" },
      { type: "submit", idempotencyKey: "first-key" },
    );
    const second = kioskFlowReducer(first, {
      type: "submit",
      idempotencyKey: "second-key",
    });
    expect(second.pending).toBe(true);
    expect(second.idempotencyKey).toBe("first-key");
  });

  it("returns a state conflict to confirmation with the latest state", () => {
    const latest = attendanceState({ state: "clocked_in", allowedActions: ["clock_out"] });
    const result = kioskFlowReducer(
      {
        ...initialKioskFlowState,
        mode: "confirm",
        pin: "4826",
        pending: true,
        idempotencyKey: "first-key",
      },
      { type: "conflict", latest },
    );
    expect(result.mode).toBe("confirm");
    expect(result.attendanceState).toEqual(latest);
    expect(result.pin).toBe("");
    expect(result.pending).toBe(false);
  });
});
