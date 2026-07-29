import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/auth/permissions", () => ({
  requireAccount: mocks.requireAccount,
}));

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import {
  removeBoundClockEventAction,
  resetBoundAttendanceToPlannedHoursAction,
  saveBoundClockEventCorrectionAction,
  useBoundPlannedHoursAction,
  type BoundAttendanceCorrectionContext,
} from "@/lib/attendance/correction-actions";

const initialState = { ok: false, code: "idle", message: "" };

function context(
  overrides: Partial<BoundAttendanceCorrectionContext> = {},
): BoundAttendanceCorrectionContext {
  return {
    staffId: "staff-1",
    attendanceDate: "2026-07-28",
    returnTo: "/attendance?view=hours&staffId=staff-1&day=2026-07-28",
    eventRevision: "events:event-1|corrections:correction-1",
    correctionId: "40000000-0000-4000-8000-000000000000",
    plannedStart: "08:00",
    plannedFinish: "17:00",
    ...overrides,
  };
}

function correctionForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const values = {
    targetEventId: "correction-1",
    correctionId: "30000000-0000-4000-8000-000000000000",
    eventType: "clock_in",
    localDateTime: "2026-07-28T09:15",
    reason: "Correcting the start time",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

function removalForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const values = {
    targetEventId: "10000000-0000-4000-8000-000000000000",
    reason: "Duplicate clock event",
    confirmed: "yes",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

function resetForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const values = {
    reason: "Return the day to the published rota",
    confirmed: "yes",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("bound manager attendance correction actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccount.mockResolvedValue({ id: "manager-1", role: "manager" });
    mocks.rpc.mockResolvedValue({ data: "batch-1", error: null });
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("sends one correction request to the authoritative locked RPC", async () => {
    const result = await saveBoundClockEventCorrectionAction(
      context(),
      initialState,
      correctionForm(),
    );

    expect(mocks.requireAccount).toHaveBeenCalledWith(["manager"]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("save_manual_clock_event_correction", {
      target_staff_id: "staff-1",
      target_date: "2026-07-28",
      target_event_id: "correction-1",
      primary_correction_id: "40000000-0000-4000-8000-000000000000",
      requested_event_type: "clock_in",
      requested_event_timestamp: "2026-07-28T08:15:00.000Z",
      reason: "Correcting the start time",
      expected_revision: "events:event-1|corrections:correction-1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/attendance");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clock");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/payroll");
    expect(result).toMatchObject({ ok: true, code: "saved" });
  });

  it("uses only bound staff, date, return route and revision context", async () => {
    const form = correctionForm();
    form.set("staffId", "staff-2");
    form.set("attendanceDate", "2026-07-29");
    form.set("returnTo", "/payroll");
    form.set("eventRevision", "fabricated");
    form.set("correctionId", "50000000-0000-4000-8000-000000000000");

    await saveBoundClockEventCorrectionAction(context(), initialState, form);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_manual_clock_event_correction",
      expect.objectContaining({
        target_staff_id: "staff-1",
        target_date: "2026-07-28",
        primary_correction_id: "40000000-0000-4000-8000-000000000000",
        expected_revision: "events:event-1|corrections:correction-1",
      }),
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/payroll", "page");
  });

  it("adds an event with a null target while preserving London instant semantics", async () => {
    await saveBoundClockEventCorrectionAction(
      context({ attendanceDate: "2026-01-28" }),
      initialState,
      correctionForm({
        targetEventId: "",
        localDateTime: "2026-01-28T23:30",
        reason: "Adding a missed clock event",
      }),
    );

    expect(mocks.rpc).toHaveBeenCalledWith("save_manual_clock_event_correction", {
      target_staff_id: "staff-1",
      target_date: "2026-01-28",
      target_event_id: null,
      primary_correction_id: "40000000-0000-4000-8000-000000000000",
      requested_event_type: "clock_in",
      requested_event_timestamp: "2026-01-28T23:30:00.000Z",
      reason: "Adding a missed clock event",
      expected_revision: "events:event-1|corrections:correction-1",
    });
  });

  it("rejects an invalid or different London date before opening a database client", async () => {
    const wrongDate = await saveBoundClockEventCorrectionAction(
      context(),
      initialState,
      correctionForm({ localDateTime: "2026-07-29T09:15" }),
    );
    const springGap = await saveBoundClockEventCorrectionAction(
      context({ attendanceDate: "2026-03-29" }),
      initialState,
      correctionForm({ localDateTime: "2026-03-29T01:30" }),
    );

    expect(wrongDate.code).toBe("invalid_correction");
    expect(springGap.code).toBe("invalid_correction");
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("returns a clear reload-and-review result for a stale preview", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "Attendance changed after this preview" },
    });

    const result = await saveBoundClockEventCorrectionAction(
      context(),
      initialState,
      correctionForm(),
    );

    expect(result).toEqual({
      ok: false,
      code: "attendance_changed",
      message: "Attendance changed after this preview. Reload the day and review it again before saving.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("binds the displayed event revision to planned-hours confirmation", async () => {
    const form = new FormData();
    form.set("reason", "Using the published rota");
    form.set("eventRevision", "fabricated");

    const result = await useBoundPlannedHoursAction(
      context(),
      initialState,
      form,
    );

    expect(mocks.rpc).toHaveBeenCalledWith("use_planned_hours", {
      target_staff_id: "staff-1",
      target_date: "2026-07-28",
      reason: "Using the published rota",
      expected_revision: "events:event-1|corrections:correction-1",
    });
    expect(result.ok).toBe(true);
  });

  it("checks manager access before rejecting malformed form data", async () => {
    mocks.requireAccount.mockRejectedValueOnce(new Error("Manager access required"));

    await expect(saveBoundClockEventCorrectionAction(
      context(),
      initialState,
      new FormData(),
    )).rejects.toThrow("Manager access required");
  });

  it("removes an event using only its form input and bound attendance context", async () => {
    const form = removalForm({ reason: "  Duplicate clock event  " });
    form.set("staffId", "staff-2");
    form.set("attendanceDate", "2026-07-29");
    form.set("eventRevision", "fabricated");
    form.set("operationId", "50000000-0000-4000-8000-000000000000");

    const result = await removeBoundClockEventAction(context(), initialState, form);

    expect(mocks.rpc).toHaveBeenCalledWith("remove_clock_event_from_hours", {
      target_staff_id: "staff-1",
      target_date: "2026-07-28",
      target_event_id: "10000000-0000-4000-8000-000000000000",
      reason: "Duplicate clock event",
      expected_revision: "events:event-1|corrections:correction-1",
      operation_id: "40000000-0000-4000-8000-000000000000",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/attendance");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clock");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/payroll");
    expect(result).toEqual({
      ok: true,
      code: "removed",
      message: "The clock event was removed from attendance hours.",
    });
  });

  it("rejects missing or incorrect removal confirmation before opening a database client", async () => {
    const missingConfirmation = removalForm();
    missingConfirmation.delete("confirmed");
    const incorrectConfirmation = removalForm({ confirmed: "on" });

    const missingResult = await removeBoundClockEventAction(context(), initialState, missingConfirmation);
    const incorrectResult = await removeBoundClockEventAction(context(), initialState, incorrectConfirmation);

    expect(missingResult).toEqual({
      ok: false,
      code: "invalid_correction",
      message: "Confirm the removal and enter a clear reason.",
    });
    expect(incorrectResult).toEqual(missingResult);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("rejects invalid removal UUIDs and short reasons before opening a database client", async () => {
    const invalidTarget = await removeBoundClockEventAction(
      context(),
      initialState,
      removalForm({ targetEventId: "not-a-uuid" }),
    );
    const invalidOperation = await removeBoundClockEventAction(
      context({ correctionId: "not-a-uuid" }),
      initialState,
      removalForm(),
    );
    const shortReason = await removeBoundClockEventAction(
      context(),
      initialState,
      removalForm({ reason: "Nope" }),
    );

    expect(invalidTarget.code).toBe("invalid_correction");
    expect(invalidOperation.code).toBe("invalid_correction");
    expect(shortReason.code).toBe("invalid_correction");
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("returns a clear reload-and-review result when removal detects a stale preview", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "Attendance changed after this preview" },
    });

    const result = await removeBoundClockEventAction(context(), initialState, removalForm());

    expect(result).toEqual({
      ok: false,
      code: "attendance_changed",
      message: "Attendance changed after this preview. Reload the day and review it again before saving.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a specific failure result when removal cannot be saved", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "Unexpected failure" } });

    const result = await removeBoundClockEventAction(context(), initialState, removalForm());

    expect(result).toEqual({
      ok: false,
      code: "remove_failed",
      message: "The clock event could not be removed from attendance hours.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("resets attendance with only bound context and revalidates the attendance routes", async () => {
    const form = resetForm({ reason: "  Return the day to the published rota  " });
    form.set("staffId", "staff-2");
    form.set("attendanceDate", "2026-07-29");
    form.set("eventRevision", "fabricated");
    form.set("operationId", "50000000-0000-4000-8000-000000000000");
    form.set("plannedStart", "02:00");
    form.set("plannedFinish", "03:00");

    const result = await resetBoundAttendanceToPlannedHoursAction(context(), initialState, form);

    expect(mocks.rpc).toHaveBeenCalledWith("reset_attendance_to_planned_hours", {
      target_staff_id: "staff-1",
      target_date: "2026-07-28",
      reason: "Return the day to the published rota",
      expected_revision: "events:event-1|corrections:correction-1",
      operation_id: "40000000-0000-4000-8000-000000000000",
      expected_planned_start: "08:00",
      expected_planned_finish: "17:00",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/attendance");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clock");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/payroll");
    expect(result).toEqual({
      ok: true,
      code: "reset",
      message: "Attendance was reset to published planned hours.",
    });
  });

  it("rejects missing or malformed bound reset boundaries before opening a database client", async () => {
    const missingStart = await resetBoundAttendanceToPlannedHoursAction(
      context({ plannedStart: undefined }),
      initialState,
      resetForm(),
    );
    const malformedFinish = await resetBoundAttendanceToPlannedHoursAction(
      context({ plannedFinish: "5pm" }),
      initialState,
      resetForm(),
    );

    expect(missingStart.code).toBe("invalid_correction");
    expect(malformedFinish.code).toBe("invalid_correction");
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("rejects missing or incorrect reset confirmation before opening a database client", async () => {
    const missingConfirmation = resetForm();
    missingConfirmation.delete("confirmed");
    const incorrectConfirmation = resetForm({ confirmed: "on" });

    const missingResult = await resetBoundAttendanceToPlannedHoursAction(context(), initialState, missingConfirmation);
    const incorrectResult = await resetBoundAttendanceToPlannedHoursAction(context(), initialState, incorrectConfirmation);

    expect(missingResult).toEqual({
      ok: false,
      code: "invalid_correction",
      message: "Confirm the reset and enter a clear reason.",
    });
    expect(incorrectResult).toEqual(missingResult);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("rejects invalid reset operation IDs and short reasons before opening a database client", async () => {
    const invalidOperation = await resetBoundAttendanceToPlannedHoursAction(
      context({ correctionId: "not-a-uuid" }),
      initialState,
      resetForm(),
    );
    const shortReason = await resetBoundAttendanceToPlannedHoursAction(
      context(),
      initialState,
      resetForm({ reason: "Nope" }),
    );

    expect(invalidOperation.code).toBe("invalid_correction");
    expect(shortReason.code).toBe("invalid_correction");
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("returns a clear reload-and-review result when reset detects a stale preview", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "Attendance changed after this preview" },
    });

    const result = await resetBoundAttendanceToPlannedHoursAction(context(), initialState, resetForm());

    expect(result).toEqual({
      ok: false,
      code: "attendance_changed",
      message: "Attendance changed after this preview. Reload the day and review it again before saving.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a specific failure result when reset cannot be saved", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "Unexpected failure" } });

    const result = await resetBoundAttendanceToPlannedHoursAction(context(), initialState, resetForm());

    expect(result).toEqual({
      ok: false,
      code: "reset_failed",
      message: "Attendance could not be reset to published planned hours.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
