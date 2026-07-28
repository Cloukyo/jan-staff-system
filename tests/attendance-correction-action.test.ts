import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
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

vi.mock("@/lib/kiosk/server", () => ({
  createPublicKioskClient: vi.fn(),
}));

vi.mock("@/lib/kiosk/device-session", () => ({
  getKioskDeviceToken: vi.fn(),
}));

import { addClockCorrectionAction } from "@/lib/kiosk/actions";
import {
  saveClockEventCorrectionAction,
  usePlannedHoursAction,
} from "@/lib/attendance/correction-actions";

function correctionForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const values = {
    staffId: "staff-1",
    eventType: "clock_in",
    eventTimestamp: "2026-07-28T09:15",
    reason: "Forgot to clock in",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("addClockCorrectionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccount.mockResolvedValue({ id: "manager-1", role: "manager" });
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(
      name === "get_effective_clock_events"
        ? { data: [], error: null }
        : { data: "batch-1", error: null },
    ));
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
  });

  it("saves a late-evening BST correction as the matching London date and UTC instant", async () => {
    const eventTimestamp = "2026-07-28T23:30";

    const result = await addClockCorrectionAction(
      { ok: false, code: "", message: "" },
      correctionForm({ eventTimestamp }),
    );

    expect(mocks.requireAccount).toHaveBeenCalledWith(["manager"]);
    expect(mocks.rpc).toHaveBeenCalledWith("save_clock_event_correction_chain", {
      plan: {
        reason: "Forgot to clock in",
        primary: {
          staff_id: "staff-1",
          recorded_date: "2026-07-28",
          correction_kind: "add",
          original_event_id: null,
          supersedes_correction_id: null,
          event_type: "clock_in",
          event_timestamp: "2026-07-28T22:30:00.000Z",
        },
        consequential: [],
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/attendance");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clock");
    expect(result).toEqual({
      ok: true,
      code: "saved",
      message: "The correction was added without changing the original clock events.",
    });
  });

  it("saves a winter GMT correction as the matching London date and UTC instant", async () => {
    await addClockCorrectionAction(
      { ok: false, code: "", message: "" },
      correctionForm({ eventTimestamp: "2026-01-28T23:30" }),
    );

    expect(mocks.rpc).toHaveBeenCalledWith("save_clock_event_correction_chain", {
      plan: {
        reason: "Forgot to clock in",
        primary: {
          staff_id: "staff-1",
          recorded_date: "2026-01-28",
          correction_kind: "add",
          original_event_id: null,
          supersedes_correction_id: null,
          event_type: "clock_in",
          event_timestamp: "2026-01-28T23:30:00.000Z",
        },
        consequential: [],
      },
    });
  });

  it("saves same-day consequential type changes for an added event without moving their timestamps", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_effective_clock_events") {
        return Promise.resolve({
          data: [
            {
              event_id: "event-2",
              original_event_id: null,
              correction_id: null,
              staff_id: "staff-1",
              event_type: "clock_in",
              event_timestamp: "2026-07-28T11:00:00.000Z",
              recorded_date: "2026-07-28",
              source: "kiosk",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: "batch-1", error: null });
    });

    await addClockCorrectionAction(
      { ok: false, code: "", message: "" },
      correctionForm({ eventType: "clock_in", eventTimestamp: "2026-07-28T08:00" }),
    );

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "get_effective_clock_events", {
      range_start: "2026-07-28",
      range_end: "2026-07-28",
      target_staff_id: "staff-1",
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "save_clock_event_correction_chain", {
      plan: expect.objectContaining({
        consequential: [{
          staff_id: "staff-1",
          recorded_date: "2026-07-28",
          correction_kind: "replace",
          original_event_id: "event-2",
          supersedes_correction_id: null,
          event_type: "clock_out",
          event_timestamp: "2026-07-28T11:00:00.000Z",
        }],
      }),
    });
  });

  it("retains validation and the existing failure message", async () => {
    const invalid = await addClockCorrectionAction(
      { ok: false, code: "", message: "" },
      correctionForm({ reason: "no" }),
    );

    expect(invalid).toEqual({
      ok: false,
      code: "invalid_correction",
      message: "Choose an event, time and a clear correction reason.",
    });
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();

    mocks.rpc.mockImplementation((name: string) => Promise.resolve(
      name === "get_effective_clock_events"
        ? { data: [], error: null }
        : { data: null, error: { message: "failed" } },
    ));
    const failed = await addClockCorrectionAction(
      { ok: false, code: "", message: "" },
      correctionForm(),
    );
    expect(failed).toEqual({
      ok: false,
      code: "save_failed",
      message: "The correction could not be recorded.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("checks manager access before rejecting an invalid compatibility form", async () => {
    mocks.requireAccount.mockRejectedValueOnce(new Error("Manager access required"));

    try {
      await expect(addClockCorrectionAction(
        { ok: false, code: "", message: "" },
        correctionForm({ eventType: "not_an_event" }),
      )).rejects.toThrow("Manager access required");
    } finally {
      mocks.requireAccount.mockReset();
    }
  });
});

describe("manager attendance correction actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccount.mockResolvedValue({ id: "manager-1", role: "manager" });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: "event-1",
        staff_id: "staff-1",
        event_type: "clock_in",
        event_timestamp: "2026-07-28T07:00:00.000Z",
        recorded_date: "2026-07-28",
      },
      error: null,
    });
    mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_effective_clock_events") {
        return Promise.resolve({
          data: [
            {
              event_id: "event-1",
              original_event_id: null,
              correction_id: null,
              staff_id: "staff-1",
              event_type: "clock_in",
              event_timestamp: "2026-07-28T07:00:00.000Z",
              recorded_date: "2026-07-28",
              source: "kiosk",
            },
            {
              event_id: "event-2",
              original_event_id: null,
              correction_id: null,
              staff_id: "staff-1",
              event_type: "clock_in",
              event_timestamp: "2026-07-28T11:00:00.000Z",
              recorded_date: "2026-07-28",
              source: "kiosk",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: "batch-1", error: null });
    });
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
  });

  it("requires a manager and rejects short correction reasons before saving", async () => {
    const result = await saveClockEventCorrectionAction({
      staffId: "staff-1",
      eventType: "clock_in",
      localDateTime: "2026-07-28T08:15",
      reason: "no",
      returnTo: "/attendance",
    });

    expect(mocks.requireAccount).toHaveBeenCalledWith(["manager"]);
    expect(result).toEqual({
      ok: false,
      code: "invalid_correction",
      message: "Choose an event, time and a clear correction reason.",
    });
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("returns invalid results for malformed manual and planned action input after manager authentication", async () => {
    const manual = await saveClockEventCorrectionAction(null as unknown as Parameters<typeof saveClockEventCorrectionAction>[0]);
    const planned = await usePlannedHoursAction(null as unknown as Parameters<typeof usePlannedHoursAction>[0]);

    expect(mocks.requireAccount).toHaveBeenCalledTimes(2);
    expect(manual).toEqual({
      ok: false,
      code: "invalid_correction",
      message: "Choose an event, time and a clear correction reason.",
    });
    expect(planned).toEqual(manual);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("loads the original event, verifies ownership and saves same-day consequential replacements", async () => {
    const result = await saveClockEventCorrectionAction({
      staffId: "staff-1",
      originalEventId: "event-1",
      eventType: "clock_in",
      localDateTime: "2026-07-28T08:15",
      reason: "Correcting the start time",
      returnTo: "/attendance",
    });

    expect(mocks.from).toHaveBeenCalledWith("clock_events");
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "get_effective_clock_events", {
      range_start: "2026-07-28",
      range_end: "2026-07-28",
      target_staff_id: "staff-1",
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "save_clock_event_correction_chain", {
      plan: {
        reason: "Correcting the start time",
        primary: {
          staff_id: "staff-1",
          recorded_date: "2026-07-28",
          correction_kind: "replace",
          original_event_id: "event-1",
          supersedes_correction_id: null,
          event_type: "clock_in",
          event_timestamp: "2026-07-28T07:15:00.000Z",
        },
        consequential: [{
          staff_id: "staff-1",
          recorded_date: "2026-07-28",
          correction_kind: "replace",
          original_event_id: "event-2",
          supersedes_correction_id: null,
          event_type: "clock_out",
          event_timestamp: "2026-07-28T11:00:00.000Z",
        }],
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/attendance");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clock");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/payroll");
    expect(result.ok).toBe(true);
  });

  it("plans consequential replacements when the selected original already has an active replacement", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_effective_clock_events") {
        return Promise.resolve({
          data: [
            {
              event_id: "correction-1",
              original_event_id: "event-1",
              correction_id: "correction-1",
              staff_id: "staff-1",
              event_type: "clock_in",
              event_timestamp: "2026-07-28T07:00:00.000Z",
              recorded_date: "2026-07-28",
              source: "manager_correction",
            },
            {
              event_id: "event-2",
              original_event_id: null,
              correction_id: null,
              staff_id: "staff-1",
              event_type: "clock_in",
              event_timestamp: "2026-07-28T11:00:00.000Z",
              recorded_date: "2026-07-28",
              source: "kiosk",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: "batch-2", error: null });
    });

    await saveClockEventCorrectionAction({
      staffId: "staff-1",
      originalEventId: "event-1",
      eventType: "clock_in",
      localDateTime: "2026-07-28T08:15",
      reason: "Correcting the start time again",
      returnTo: "/attendance",
    });

    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "save_clock_event_correction_chain", expect.objectContaining({
      plan: expect.objectContaining({
        consequential: [{
          staff_id: "staff-1",
          recorded_date: "2026-07-28",
          correction_kind: "replace",
          original_event_id: "event-2",
          supersedes_correction_id: null,
          event_type: "clock_out",
          event_timestamp: "2026-07-28T11:00:00.000Z",
        }],
      }),
    }));
  });

  it("returns load_failed when the original clock event lookup fails", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "database unavailable" } });

    const result = await saveClockEventCorrectionAction({
      staffId: "staff-1",
      originalEventId: "event-1",
      eventType: "clock_in",
      localDateTime: "2026-07-28T08:15",
      reason: "Correcting the start time",
      returnTo: "/attendance",
    });

    expect(result).toEqual({
      ok: false,
      code: "load_failed",
      message: "The original clock event could not be loaded.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns invalid_correction when the original clock event is absent", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await saveClockEventCorrectionAction({
      staffId: "staff-1",
      originalEventId: "event-1",
      eventType: "clock_in",
      localDateTime: "2026-07-28T08:15",
      reason: "Correcting the start time",
      returnTo: "/attendance",
    });

    expect(result.code).toBe("invalid_correction");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an original event owned by a different staff member", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: {
        id: "event-1",
        staff_id: "staff-2",
        event_type: "clock_in",
        event_timestamp: "2026-07-28T07:00:00.000Z",
        recorded_date: "2026-07-28",
      },
      error: null,
    });

    const result = await saveClockEventCorrectionAction({
      staffId: "staff-1",
      originalEventId: "event-1",
      eventType: "clock_in",
      localDateTime: "2026-07-28T08:15",
      reason: "Correcting the start time",
      returnTo: "/attendance",
    });

    expect(result.code).toBe("invalid_correction");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sends only staff, attendance date and reason to the planned-hours RPC", async () => {
    const result = await usePlannedHoursAction({
      staffId: "staff-1",
      attendanceDate: "2026-07-28",
      reason: "Using the published rota",
    });

    expect(mocks.requireAccount).toHaveBeenCalledWith(["manager"]);
    expect(mocks.rpc).toHaveBeenCalledWith("use_planned_hours", {
      target_staff_id: "staff-1",
      target_date: "2026-07-28",
      reason: "Using the published rota",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/attendance");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clock");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/payroll");
    expect(result.ok).toBe(true);
  });
});
