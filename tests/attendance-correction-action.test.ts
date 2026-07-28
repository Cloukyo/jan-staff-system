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

vi.mock("@/lib/kiosk/server", () => ({
  createPublicKioskClient: vi.fn(),
}));

vi.mock("@/lib/kiosk/device-session", () => ({
  getKioskDeviceToken: vi.fn(),
}));

import { addClockCorrectionAction } from "@/lib/kiosk/actions";

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
    mocks.rpc.mockResolvedValue({ data: "batch-1", error: null });
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc });
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

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "failed" } });
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
});
