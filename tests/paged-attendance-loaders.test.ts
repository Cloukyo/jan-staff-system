import { beforeEach, describe, expect, it, vi } from "vitest";
import { PagedPostgrestClient, type TestRow } from "./helpers/paged-postgrest";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
  requireAccount: vi.fn(),
}));

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createServiceRoleClient,
}));

vi.mock("@/lib/auth/permissions", () => ({
  requireAccount: mocks.requireAccount,
}));

vi.mock("@/lib/auth/config", () => ({
  getSupabaseConfig: () => ({ url: "https://example.supabase.co", anonKey: "anon" }),
}));

import {
  loadAttendanceReviewReadiness,
  loadManagerHoursPreview,
} from "@/lib/attendance/review-server";
import {
  loadPayrollAttendanceReviews,
  loadPayrollRotaShifts,
  loadProductionAttendanceData,
} from "@/lib/payroll/server";
import { loadStaffAttendance } from "@/lib/staff-self-service/server";

const date = "2026-07-01";
const timestamp = "2026-07-01T09:00:00+01:00";

function originalRow(index: number, staffId = `original-staff-${index}`): TestRow {
  return {
    id: `original-${String(index).padStart(5, "0")}`,
    staff_id: staffId,
    event_type: "clock_in",
    event_timestamp: timestamp,
    recorded_date: date,
    event_source: "kiosk",
    manager_correction: false,
    correction_reason: null,
  };
}

function correctionRow(index: number, staffId = `correction-staff-${index}`): TestRow {
  return {
    id: `correction-${String(index).padStart(5, "0")}`,
    batch_id: `batch-${String(index).padStart(5, "0")}`,
    correction_role: "primary",
    staff_id: staffId,
    correction_kind: "add",
    original_event_id: null,
    supersedes_correction_id: null,
    event_type: "clock_out",
    event_timestamp: timestamp,
    recorded_date: date,
    reason: "Manager confirmed attendance",
    created_by: "manager",
    created_at: "2026-07-02T09:00:00Z",
  };
}

describe("paged attendance data loaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    mocks.requireAccount.mockResolvedValue({
      id: "account",
      staffId: "own-staff",
      role: "staff",
    });
  });

  it("rejects 367-day manager and payroll ranges before starting data reads", async () => {
    const from = "2026-01-01";
    const to = "2027-01-02";

    await expect(loadProductionAttendanceData(from, to))
      .rejects.toThrow("Choose a valid date range of up to 366 days.");
    await expect(loadPayrollAttendanceReviews(from, to))
      .rejects.toThrow("Choose a valid date range of up to 366 days.");
    await expect(loadPayrollRotaShifts(from, to))
      .rejects.toThrow("Choose a valid date range of up to 366 days.");
    await expect(loadAttendanceReviewReadiness(from, to))
      .rejects.toThrow("Choose a valid date range of up to 366 days.");
    await expect(loadManagerHoursPreview(from, to))
      .rejects.toThrow("Choose a valid date range of up to 366 days.");

    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("aggregates multi-page payroll originals, corrections and reviews", async () => {
    const client = new PagedPostgrestClient({
      clock_events: Array.from({ length: 1_001 }, (_, index) => originalRow(index)),
      clock_event_corrections: Array.from(
        { length: 1_001 },
        (_, index) => correctionRow(index),
      ),
      attendance_day_reviews: Array.from({ length: 1_001 }, (_, index) => ({
        staff_id: `review-staff-${index}`,
        review_date: date,
        status: "approved",
        reason: null,
      })),
    });
    mocks.createSupabaseServerClient.mockResolvedValue(client);

    const attendance = await loadProductionAttendanceData(date, date);
    const reviews = await loadPayrollAttendanceReviews(date, date);

    expect(attendance.audit.originalEvents).toHaveLength(1_001);
    expect(attendance.audit.correctionRecords).toHaveLength(1_001);
    expect(reviews).toHaveLength(1_001);
    expect(client.rangesFor("clock_events")).toEqual([[0, 999], [1_000, 1_999]]);
    expect(client.rangesFor("clock_event_corrections")).toEqual([[0, 999], [1_000, 1_999]]);
    expect(client.rangesFor("attendance_day_reviews")).toEqual([[0, 999], [1_000, 1_999]]);
    expect(client.ordersFor("clock_events")[0]).toEqual(["event_timestamp", "id"]);
    expect(client.ordersFor("clock_event_corrections")[0]).toEqual(["created_at", "id"]);
    expect(client.ordersFor("attendance_day_reviews")[0]).toEqual(["review_date", "staff_id"]);
  });

  it("aggregates multi-page readiness sources and continues after an exactly-full page", async () => {
    const originals = Array.from({ length: 1_001 }, (_, index) => originalRow(index));
    const corrections = Array.from({ length: 1_001 }, (_, index) => correctionRow(index));
    const reviews = [
      ...Array.from({ length: 1_000 }, (_, index) => ({
        staff_id: `original-staff-${index}`,
        review_date: date,
        status: "approved",
      })),
      ...Array.from({ length: 1_000 }, (_, index) => ({
        staff_id: `correction-staff-${index}`,
        review_date: date,
        status: "approved",
      })),
    ];
    const client = new PagedPostgrestClient({
      clock_events: originals,
      clock_event_corrections: corrections,
      attendance_day_reviews: reviews,
      attendance_correction_requests: Array.from({ length: 1_001 }, (_, index) => ({
        id: `request-${String(index).padStart(5, "0")}`,
        status: "pending",
        attendance_date: date,
      })),
    });
    mocks.createSupabaseServerClient.mockResolvedValue(client);

    const readiness = await loadAttendanceReviewReadiness(date, date);

    expect(readiness).toEqual({ unresolved: 2, pendingRequests: 1_001 });
    expect(client.rangesFor("attendance_day_reviews")).toEqual([
      [0, 999],
      [1_000, 1_999],
      [2_000, 2_999],
    ]);
    expect(client.rangesFor("attendance_correction_requests")).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
    expect(client.rangesFor("clock_events")).toEqual([[0, 999], [1_000, 1_999]]);
    expect(client.rangesFor("clock_event_corrections")).toEqual([[0, 999], [1_000, 1_999]]);
    expect(client.ordersFor("attendance_correction_requests")[0]).toEqual([
      "attendance_date",
      "id",
    ]);
    expect(client.ordersFor("clock_events")[0]).toEqual(["event_timestamp", "id"]);
    expect(client.ordersFor("clock_event_corrections")[0]).toEqual(["created_at", "id"]);
  });

  it("aggregates the authenticated own-attendance RPC without a service-role client", async () => {
    const serverClient = new PagedPostgrestClient({
      get_own_attendance_records: [
        ...Array.from({ length: 1_001 }, (_, index) => ({
          ...originalRow(index, "own-staff"),
          record_kind: "original",
          correction_kind: null,
          original_event_id: null,
          supersedes_correction_id: null,
          created_at: timestamp,
        })),
        ...Array.from({ length: 1_001 }, (_, index) => {
          const row = correctionRow(index, "own-staff");
          return {
            record_kind: "correction",
            id: row.id,
            event_type: row.event_type,
            event_timestamp: row.event_timestamp,
            recorded_date: row.recorded_date,
            event_source: null,
            manager_correction: true,
            correction_kind: row.correction_kind,
            original_event_id: row.original_event_id,
            supersedes_correction_id: row.supersedes_correction_id,
            created_at: row.created_at,
          };
        }),
      ],
    });
    mocks.createSupabaseServerClient.mockResolvedValue(serverClient);

    const attendance = await loadStaffAttendance(date, date);

    expect(attendance.days[0].originalEvents).toHaveLength(1_001);
    expect(attendance.days[0].corrections).toHaveLength(1_001);
    expect(serverClient.rangesFor("get_own_attendance_records")).toEqual([
      [0, 999],
      [1_000, 1_999],
      [2_000, 2_999],
    ]);
    expect(serverClient.rpcArgsFor("get_own_attendance_records")).toEqual([
      { range_start: date, range_end: date },
      { range_start: date, range_end: date },
      { range_start: date, range_end: date },
    ]);
    expect(serverClient.ordersFor("get_own_attendance_records")[0]).toEqual([
      "recorded_date",
      "id",
    ]);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });
});
