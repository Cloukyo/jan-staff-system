import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: createServerClient,
}));

import {
  commercialPayrollRepository,
  loadApprovedCommercialPayrollExport,
  loadCommercialPayrollReportingState,
  loadCommercialPayrollWorkspace,
  type CommercialPayrollRepository,
} from "@/lib/payroll/tenant-server";
import type { CommercialPayArrangement } from "@/lib/payroll/tenant-types";
import type { CommercialMembershipContext } from "@/types/tenancy";

const ORGANISATION_A = "10000000-0000-4000-8000-000000000000";
const SITE_A = "11000000-0000-4000-8000-000000000000";
const SITE_B = "12000000-0000-4000-8000-000000000000";

type QueryCall = [method: string, ...arguments_: unknown[]];

function queryResult(data: unknown[], calls: QueryCall[]) {
  const query = {
    select(...arguments_: unknown[]) { calls.push(["select", ...arguments_]); return query; },
    eq(...arguments_: unknown[]) { calls.push(["eq", ...arguments_]); return query; },
    lte(...arguments_: unknown[]) { calls.push(["lte", ...arguments_]); return query; },
    gte(...arguments_: unknown[]) { calls.push(["gte", ...arguments_]); return query; },
    or(...arguments_: unknown[]) { calls.push(["or", ...arguments_]); return query; },
    in(...arguments_: unknown[]) { calls.push(["in", ...arguments_]); return query; },
    is(...arguments_: unknown[]) { calls.push(["is", ...arguments_]); return query; },
    neq(...arguments_: unknown[]) { calls.push(["neq", ...arguments_]); return query; },
    order(...arguments_: unknown[]) { calls.push(["order", ...arguments_]); return query; },
    limit(...arguments_: unknown[]) { calls.push(["limit", ...arguments_]); return query; },
    maybeSingle() { calls.push(["maybeSingle"]); return Promise.resolve({ data: data[0] ?? null, error: null }); },
    single() { calls.push(["single"]); return Promise.resolve({ data: data[0] ?? null, error: null }); },
    then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
    },
  };
  return query;
}

function context(): CommercialMembershipContext {
  return {
    membershipId: "31000000-0000-4000-8000-000000000000",
    organisationId: ORGANISATION_A,
    organisationDisplayName: "Fictional Nursery Group",
    organisationStatus: "active",
    organisationArchived: false,
    status: "active",
    active: true,
    staffId: "staff-a",
    authorisationRevision: 3,
    roles: [],
    siteAccess: [SITE_A],
    sitePermissions: { [SITE_A]: ["payroll.read"] },
    selectedSiteId: SITE_A,
    permittedSiteIds: [SITE_A],
    permissions: ["payroll.read"],
  };
}

function arrangement(staffId: string, id: string): CommercialPayArrangement {
  return {
    organisationId: ORGANISATION_A,
    id,
    staffId,
    payType: "hourly",
    hourlyRate: 12,
    annualSalary: null,
    monthlySalary: null,
    contractedWeeklyHours: 35,
    hoursBasis: "contracted",
    standardDailyHours: 7,
    overtimeMultiplier: 1.5,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    isActive: true,
    managerNotes: null,
    createdByName: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  createServerClient.mockReset();
});

describe("commercial payroll site scoping", () => {
  it("loads effective assignment intervals separately for snapshot classification", async () => {
    const calls: QueryCall[] = [];
    createServerClient.mockResolvedValue({
      from(table: string) {
        if (table !== "staff_site_assignments") throw new Error(`Unexpected table ${table}`);
        return queryResult([{
          organisation_id: ORGANISATION_A,
          staff_id: "staff-a",
          site_id: SITE_A,
          effective_from: "2026-07-01",
          effective_to: "2026-08-03",
          is_primary: true,
        }], calls);
      },
    });
    const loadAssignments = (commercialPayrollRepository as unknown as {
      loadAssignments?: (scope: Parameters<CommercialPayrollRepository["loadStaff"]>[0]) => Promise<unknown[]>;
    }).loadAssignments;
    expect(loadAssignments).toBeTypeOf("function");
    if (!loadAssignments) return;

    await expect(loadAssignments({
      organisationId: ORGANISATION_A,
      siteId: SITE_A,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-07",
    })).resolves.toEqual([expect.objectContaining({
      staffId: "staff-a",
      siteId: SITE_A,
      effectiveTo: "2026-08-03",
    })]);
    expect(calls).toContainEqual(["lte", "effective_from", "2026-08-07"]);
    expect(calls).toContainEqual(["or", "effective_to.is.null,effective_to.gte.2026-08-01"]);
  });

  it("retains staff assigned to the selected site for any part of the pay period", async () => {
    const callsByTable = new Map<string, QueryCall[]>();
    createServerClient.mockResolvedValue({
      from(table: string) {
        const calls: QueryCall[] = [];
        callsByTable.set(table, calls);
        if (table === "staff_profiles") {
          return queryResult([{
            id: "staff-a",
            organisation_id: ORGANISATION_A,
            full_name: "Fictional Practitioner",
            employment_role: "Practitioner",
            active: true,
          }], calls);
        }
        if (table === "staff_site_assignments") {
          return queryResult([
            {
              staff_id: "staff-a",
              site_id: SITE_A,
              effective_from: "2026-07-01",
              effective_to: "2026-08-03",
              is_primary: true,
            },
            {
              staff_id: "staff-a",
              site_id: SITE_B,
              effective_from: "2026-08-04",
              effective_to: null,
              is_primary: true,
            },
          ], calls);
        }
        throw new Error(`Unexpected table ${table}`);
      },
    });

    const staff = await commercialPayrollRepository.loadStaff({
      organisationId: ORGANISATION_A,
      siteId: SITE_A,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-07",
    });

    expect(staff).toEqual([expect.objectContaining({
      id: "staff-a",
      currentSiteId: SITE_B,
    })]);
    expect(callsByTable.get("staff_site_assignments")).toContainEqual([
      "or",
      "effective_to.is.null,effective_to.gte.2026-08-01",
    ]);
  });

  it("keeps inactive and unrelated staff out of authoritative payroll snapshots", async () => {
    const callsByTable = new Map<string, QueryCall[]>();
    createServerClient.mockResolvedValue({
      from(table: string) {
        const calls: QueryCall[] = [];
        callsByTable.set(table, calls);
        if (table === "staff_profiles") {
          return queryResult([
            {
              id: "active-staff",
              organisation_id: ORGANISATION_A,
              full_name: "Active Example",
              employment_role: "Practitioner",
              active: true,
            },
            {
              id: "inactive-staff",
              organisation_id: ORGANISATION_A,
              full_name: "Inactive Example",
              employment_role: "Practitioner",
              active: false,
            },
          ], calls);
        }
        if (table === "staff_site_assignments") {
          return queryResult([
            {
              staff_id: "active-staff",
              site_id: SITE_A,
              effective_from: "2026-01-01",
              effective_to: null,
              is_primary: true,
            },
            {
              staff_id: "inactive-staff",
              site_id: SITE_A,
              effective_from: "2026-01-01",
              effective_to: null,
              is_primary: true,
            },
          ], calls);
        }
        throw new Error(`Unexpected table ${table}`);
      },
    });

    const staff = await commercialPayrollRepository.loadStaff({
      organisationId: ORGANISATION_A,
      siteId: SITE_A,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-07",
    });

    expect(staff.map((person) => person.id)).toEqual(["active-staff"]);
    expect(callsByTable.get("staff_profiles")).toContainEqual(["eq", "active", true]);
  });

  it("excludes organisation-wide pay arrangements belonging to other-site staff", async () => {
    const staff = [{
      organisationId: ORGANISATION_A,
      id: "staff-a",
      fullName: "Fictional Practitioner",
      employmentRole: "Practitioner",
      currentSiteId: SITE_A,
    }];
    const ownArrangement = arrangement("staff-a", "pay-a");
    const foreignSiteArrangement = arrangement("staff-b", "pay-b");
    const repository = (payArrangements: CommercialPayArrangement[]): CommercialPayrollRepository => ({
      loadStaff: async () => staff,
      loadPayArrangements: async () => payArrangements,
      loadEffectiveEvents: async () => [],
      loadAttendanceReviews: async () => [],
      loadAttendanceExceptions: async () => [],
      loadAttendanceRequests: async () => [],
      loadRotaShifts: async () => [],
    });

    const scoped = await loadCommercialPayrollWorkspace(
      context(),
      { periodStart: "2026-08-01", periodEnd: "2026-08-07" },
      repository([ownArrangement, foreignSiteArrangement]),
    );
    const ownOnly = await loadCommercialPayrollWorkspace(
      context(),
      { periodStart: "2026-08-01", periodEnd: "2026-08-07" },
      repository([ownArrangement]),
    );

    expect(scoped.snapshot.payArrangementFingerprint)
      .toBe(ownOnly.snapshot.payArrangementFingerprint);
  });

  it("loads only tenant-owned planned shifts through the guarded rota RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        shift_id: "40000000-0000-4000-8000-000000000001",
        staff_id: "staff-a",
        shift_date: "2026-08-05",
        start_time: "09:00:00",
        end_time: "17:00:00",
        break_minutes: 30,
      }],
      error: null,
    });
    createServerClient.mockResolvedValue({
      rpc,
    });

    await expect(commercialPayrollRepository.loadRotaShifts({
      organisationId: ORGANISATION_A,
      siteId: SITE_A,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-07",
    })).resolves.toEqual([expect.objectContaining({
      id: "40000000-0000-4000-8000-000000000001",
      staffId: "staff-a",
      shiftDate: "2026-08-05",
    })]);
    expect(rpc).toHaveBeenCalledWith("get_commercial_planned_shifts", {
      target_organisation_id: ORGANISATION_A,
      target_site_id: SITE_A,
      range_start: "2026-08-01",
      range_end: "2026-08-07",
      target_staff_id: null,
    });
  });

  it("loads reporting rows and adjustment evidence only through the guarded report RPC", async () => {
    const fromTables: string[] = [];
    const rpcCalls: Array<[string, Record<string, unknown>]> = [];
    createServerClient.mockResolvedValue({
      from(table: string) {
        fromTables.push(table);
        if (["payroll_preparation_rows", "payroll_adjustments", "staff_profiles"]
          .includes(table)) {
          throw new Error(`Sensitive table read attempted: ${table}`);
        }
        const calls: QueryCall[] = [];
        if (table === "payroll_periods") return queryResult([{
          id: "20000000-0000-4000-8000-000000000000",
          status: "open",
          revision: 2,
        }], calls);
        if (table === "organisation_sites") return queryResult([{ name: "Central Site" }], calls);
        if (table === "payroll_preparation_runs") return queryResult([{
          id: "30000000-0000-4000-8000-000000000000",
        }], calls);
        throw new Error(`Unexpected table ${table}`);
      },
      async rpc(name: string, parameters: Record<string, unknown>) {
        rpcCalls.push([name, parameters]);
        return {
          error: null,
          data: {
            ok: true,
            code: "report_loaded",
            organisationId: ORGANISATION_A,
            periodId: "20000000-0000-4000-8000-000000000000",
            isFresh: false,
            staleCode: "stale_adjustment_fingerprint",
            run: {
              id: "30000000-0000-4000-8000-000000000000",
              status: "ready",
              revision: 2,
              blockerCount: 0,
              warningCount: 0,
              informationalCount: 0,
              siteFilterId: SITE_A,
              siteFilterDisplayName: "Central Site",
              warningCodes: [],
              warningsAcknowledged: false,
            },
            approval: null,
            lastExport: null,
            rows: [{
              organisationId: ORGANISATION_A,
              runId: "30000000-0000-4000-8000-000000000000",
              staffId: "staff-a",
              sourceKind: "attendance",
              fullName: "Fictional Practitioner",
              employmentRole: "Practitioner",
              siteId: SITE_A,
              siteDisplayName: "Central Site",
              operationalDate: "2026-08-03",
              payType: "hourly",
              rawMinutes: 510,
              adjustmentMinutes: 0,
              payableMinutes: 510,
              ordinaryMinutes: 480,
              overtimeMinutes: 30,
              estimatedGrossValue: 108.38,
              currencyCode: "GBP",
              warnings: [],
            }],
            adjustments: [],
            adjustmentTargets: [{
              key: `attendance:staff-a:${SITE_A}:2026-08-03`,
              label: "Fictional Practitioner, Central Site, 03/08/2026",
              target: {
                kind: "attendance",
                staffId: "staff-a",
                siteId: SITE_A,
                operationalDate: "2026-08-03",
              },
            }, {
              key: `site-summary:staff-ab:${SITE_A}`,
              label: "Fictional Multi-site Practitioner, Central Site, site summary",
              target: {
                kind: "site_summary",
                staffId: "staff-ab",
                siteId: SITE_A,
                operationalDate: null,
              },
            }],
          },
        };
      },
    });

    const result = await loadCommercialPayrollReportingState(context(), {
      periodStart: "2026-08-01",
      periodEnd: "2026-08-07",
    });

    expect(rpcCalls).toEqual([[
      "get_commercial_payroll_run_report",
      {
        target_run_id: "30000000-0000-4000-8000-000000000000",
        requested_site_id: SITE_A,
      },
    ]]);
    expect(result).toMatchObject({
      isFresh: false,
      staleCode: "stale_adjustment_fingerprint",
      rows: [expect.objectContaining({ staffId: "staff-a", siteId: SITE_A })],
      adjustmentTargets: [
        expect.objectContaining({ target: expect.objectContaining({ kind: "attendance" }) }),
        expect.objectContaining({
          target: {
            kind: "site_summary",
            staffId: "staff-ab",
            siteId: SITE_A,
            operationalDate: null,
          },
        }),
      ],
    });
    expect(fromTables).not.toContain("payroll_preparation_rows");
    expect(fromTables).not.toContain("payroll_adjustments");
  });

  it("loads approved export evidence only through the guarded export RPC", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    createServerClient.mockResolvedValue({
      from(table: string) {
        throw new Error(`Direct export table read attempted: ${table}`);
      },
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push([name, parameters]);
        return {
          error: null,
          data: {
            ok: true,
            code: "approved_export_loaded",
            organisationId: ORGANISATION_A,
            organisationDisplayName: "Fictional Nursery Group",
            siteId: SITE_A,
            siteDisplayName: "Central Site",
            periodId: "20000000-0000-4000-8000-000000000000",
            periodStart: "2026-08-01",
            periodEnd: "2026-08-07",
            runId: "30000000-0000-4000-8000-000000000000",
            approvalId: "40000000-0000-4000-8000-000000000000",
            revision: 2,
            approvalStatus: "approved",
            rowFingerprint: "d".repeat(64),
            payableMinutes: 510,
            adjustmentMinutes: 0,
            readiness: { blocker: 0, warning: 0, informational: 0 },
            rows: [],
            adjustmentSnapshots: [],
          },
        };
      },
    });

    const result = await loadApprovedCommercialPayrollExport({
      organisationId: ORGANISATION_A,
      periodId: "20000000-0000-4000-8000-000000000000",
      approvalId: "40000000-0000-4000-8000-000000000000",
      expectedRevision: 2,
      siteId: SITE_A,
    });

    expect(calls).toEqual([[
      "get_commercial_approved_payroll_export",
      {
        target_approval_id: "40000000-0000-4000-8000-000000000000",
        expected_revision: 2,
      },
    ]]);
    expect(result).toMatchObject({
      organisationId: ORGANISATION_A,
      siteId: SITE_A,
      rowFingerprint: "d".repeat(64),
      payableMinutesTotal: 510,
      adjustmentMinutesTotal: 0,
    });
  });
});
