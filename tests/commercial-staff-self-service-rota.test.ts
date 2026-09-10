// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
  from: vi.fn(),
  requireAccount: vi.fn(),
  requireSelfActor: vi.fn(),
}));

vi.mock("@/lib/auth/supabase-admin", () => ({
  createSupabaseAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: mocks.createServerClient,
}));

vi.mock("@/lib/auth/permissions", () => ({
  requireAccount: mocks.requireAccount,
}));

vi.mock("@/lib/attendance/server-actor", () => ({
  requireAttendanceSelfActor: mocks.requireSelfActor,
}));

import { loadStaffRotaWeek } from "@/lib/staff-self-service/server";

type QueryResult = { data: unknown; error: null };

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "lte", "gte", "order"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: QueryResult) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder as Record<string, ReturnType<typeof vi.fn>> & {
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccount.mockImplementation(() => {
    throw new Error("commercial staff rota used the legacy account guard");
  });
  mocks.requireSelfActor.mockResolvedValue({
    kind: "commercial",
    context: {
      organisationId: "organisation-a",
      selectedSiteId: "site-a",
      staffId: "staff-a",
    },
  });
});

describe("commercial staff rota self-service", () => {
  it("loads only the authenticated staff member's published rota and leave in the selected tenant context", async () => {
    const week = query({ data: { id: "week-a", published_at: "2026-06-14T16:00:00Z" }, error: null });
    const leave = query({
      data: [{ id: "leave-a", start_date: "2026-06-17", end_date: "2026-06-17", day_part: "full_day", start_time: null, end_time: null }],
      error: null,
    });
    const shifts = query({
      data: [{ id: "shift-a", shift_date: "2026-06-16", start_time: "08:00:00", end_time: "16:00:00", break_minutes: 30, break_unspecified: false, work_area: "Owls", room_or_area: null, role_on_shift: "Practitioner", status: "scheduled" }],
      error: null,
    });
    const queries = { rota_weeks: week, leave_requests: leave, rota_shifts: shifts };
    mocks.from.mockImplementation((table: keyof typeof queries) => queries[table]);
    mocks.createAdminClient.mockReturnValue({ from: mocks.from });

    await expect(loadStaffRotaWeek("2026-06-15")).resolves.toEqual({
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
      publishedAt: "2026-06-14T16:00:00Z",
      shifts: [{
        id: "shift-a",
        shiftDate: "2026-06-16",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 30,
        breakUnspecified: false,
        workArea: "Owls",
        roomOrArea: "Owls",
        roleOnShift: "Practitioner",
        status: "scheduled",
      }],
      leave: [{
        id: "leave-a",
        startDate: "2026-06-17",
        endDate: "2026-06-17",
        dayPart: "full_day",
        startTime: null,
        endTime: null,
      }],
    });

    expect(mocks.requireSelfActor).toHaveBeenCalledOnce();
    expect(mocks.requireAccount).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(week.eq).toHaveBeenCalledWith("organisation_id", "organisation-a");
    expect(week.eq).toHaveBeenCalledWith("site_id", "site-a");
    expect(leave.eq).toHaveBeenCalledWith("organisation_id", "organisation-a");
    expect(leave.eq).toHaveBeenCalledWith("staff_id", "staff-a");
    expect(shifts.eq).toHaveBeenCalledWith("organisation_id", "organisation-a");
    expect(shifts.eq).toHaveBeenCalledWith("site_id", "site-a");
    expect(shifts.eq).toHaveBeenCalledWith("staff_id", "staff-a");
  });
});
