import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCustomerDomainActor: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  readFirstWorksheetRows: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/customer-domain/server-actor", () => ({
  requireCustomerDomainActor: mocks.requireCustomerDomainActor,
}));
vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/lib/exports/workbook-reader", () => ({
  readFirstWorksheetRows: mocks.readFirstWorksheetRows,
}));
vi.mock("@/lib/payroll/review", () => ({ loadPayrollReview: vi.fn() }));

import {
  createPayrollReviewBatchAction,
  markPayrollBatchReadyAction,
  savePayrollReviewRowAction,
  updatePayrollBatchDateConfirmationAction,
} from "@/lib/payroll/review-actions";

const initialState = { ok: false, message: "" };
const context = {
  membershipId: "aa000000-0000-0000-0000-000000000001",
  organisationId: "10000000-0000-0000-0000-000000000001",
  selectedSiteId: "11000000-0000-0000-0000-000000000001",
};

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("commercial payroll review actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCustomerDomainActor.mockResolvedValue({ kind: "commercial", context });
    mocks.readFirstWorksheetRows.mockResolvedValue([
      [null, "Staff A"],
      [], [], [], [], [], [], [],
      [null, 13.25],
    ]);
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "preview_commercial_payroll_import_batch"
        ? { batchId: "70000000-0000-0000-0000-000000000001" }
        : { ok: true },
      error: null,
    }));
    const profiles = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: "tenant-staff-a", full_name: "Staff A" }],
        error: null,
      }),
    };
    mocks.createSupabaseServerClient.mockResolvedValue({
      from: vi.fn().mockReturnValue(profiles),
      rpc: mocks.rpc,
    });
  });

  it("takes a commercial workbook upload through manager-confirmed values to a committable preview", async () => {
    const upload = form({ proposedEffectiveDate: "2026-09-01" });
    upload.set("workbook", new File(["workbook"], "commercial-payroll.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    await expect(createPayrollReviewBatchAction(initialState, upload)).resolves.toMatchObject({ ok: true });

    await expect(savePayrollReviewRowAction(initialState, form({
      batchId: "70000000-0000-0000-0000-000000000001",
      rowId: "71000000-0000-0000-0000-000000000001",
      resolution: "current_staff",
      selectedStaffId: "tenant-staff-a",
      payType: "hourly",
      hourlyRate: "13.25",
      contractedWeeklyHours: "40",
      hoursBasis: "contracted",
      effectiveFrom: "2026-09-01",
      managerNotes: "Manager confirmed workbook row",
    }))).resolves.toMatchObject({ ok: true });

    await expect(updatePayrollBatchDateConfirmationAction(initialState, form({
      batchId: "70000000-0000-0000-0000-000000000001",
      proposedEffectiveDate: "2026-09-01",
      globalEffectiveDateConfirmed: "on",
    }))).resolves.toMatchObject({ ok: true });
    await expect(markPayrollBatchReadyAction(initialState, form({
      batchId: "70000000-0000-0000-0000-000000000001",
    }))).resolves.toMatchObject({ ok: true });

    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "save_commercial_payroll_import_review_row", {
      target_batch_id: "70000000-0000-0000-0000-000000000001",
      target_row_id: "71000000-0000-0000-0000-000000000001",
      target_resolution: "current_staff",
      target_selected_staff_id: "tenant-staff-a",
      target_pay_type: "hourly",
      target_hourly_rate: 13.25,
      target_annual_salary: null,
      target_monthly_salary: null,
      target_contracted_weekly_hours: 40,
      target_hours_basis: "contracted",
      target_effective_from: "2026-09-01",
      target_manager_notes: "Manager confirmed workbook row",
      target_duplicate_mapping_confirmed: false,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, "update_commercial_payroll_import_batch_date", {
      target_batch_id: "70000000-0000-0000-0000-000000000001",
      target_proposed_effective_date: "2026-09-01",
      target_global_effective_date_confirmed: true,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(4, "mark_commercial_payroll_import_batch_ready", {
      target_batch_id: "70000000-0000-0000-0000-000000000001",
      target_operation_id: "70000000-0000-0000-0000-000000000001",
    });
  });
});

describe("commercial payroll adjustment lifecycle actions", () => {
  const identity = {
    authUserId: "a0000000-0000-4000-8000-000000000001",
    email: "payroll@example.test",
    aal: "aal2" as const,
    memberships: [{
      membershipId: context.membershipId,
      organisationId: context.organisationId,
      organisationDisplayName: "Fictional Nursery Group",
      organisationStatus: "active" as const,
      organisationArchived: false,
      status: "active" as const,
      active: true,
      staffId: "tenant-staff-a",
      authorisationRevision: 1,
      roles: [],
      siteAccess: [context.selectedSiteId],
      permissions: ["payroll.read", "payroll.prepare", "payroll.export"] as const,
      sitePermissions: {
        [context.selectedSiteId]: ["payroll.read", "payroll.prepare", "payroll.export"] as const,
      },
    }],
  };
  const membership = {
    membershipId: context.membershipId,
    organisationId: context.organisationId,
    organisationDisplayName: "Fictional Nursery Group",
    organisationStatus: "active" as const,
    organisationArchived: false,
    status: "active" as const,
    active: true,
    staffId: "tenant-staff-a",
    authorisationRevision: 1,
    roles: [],
    siteAccess: [context.selectedSiteId],
    sitePermissions: {
      [context.selectedSiteId]: ["payroll.read", "payroll.prepare", "payroll.export"] as const,
    },
    selectedSiteId: context.selectedSiteId,
    permittedSiteIds: [context.selectedSiteId],
    permissions: ["payroll.read", "payroll.prepare", "payroll.export"] as const,
  };

  function mutationDependencies(calls: Array<{ name: string; parameters: Record<string, unknown> }>) {
    return {
      loadAuthorisation: async () => ({ identity, context: membership }),
      rpc: async (name: string, parameters: Record<string, unknown>) => {
        calls.push({ name, parameters });
        return { data: { ok: true, code: "saved" }, error: null };
      },
      revalidate: () => undefined,
    };
  }

  it("sends an explicit stable target only to the v2 create command", async () => {
    const payrollActions = await import("@/lib/payroll/tenant-actions");
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
    const create = payrollActions.createCommercialPayrollAdjustment as unknown as (
      input: Record<string, unknown>,
      dependencies: ReturnType<typeof mutationDependencies>,
    ) => Promise<unknown>;

    await create({
      periodId: "72000000-0000-4000-8000-000000000001",
      expectedRevision: 4,
      operationId: "74000000-0000-4000-8000-000000000001",
      target: {
        kind: "attendance",
        staffId: "tenant-staff-a",
        siteId: context.selectedSiteId,
        operationalDate: "2026-08-03",
      },
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    }, mutationDependencies(calls) as never);

    expect(calls).toEqual([{
      name: "create_commercial_payroll_adjustment_v2",
      parameters: {
        target_period_id: "72000000-0000-4000-8000-000000000001",
        expected_revision: 4,
        operation_id: "74000000-0000-4000-8000-000000000001",
        target_staff_id: "tenant-staff-a",
        target_kind: "attendance",
        target_site_id: context.selectedSiteId,
        target_operational_date: "2026-08-03",
        adjustment_minutes: 15,
        reason: "Confirmed paid handover time",
      },
    }]);
  });

  it("routes approval only through the v2 validator command", async () => {
    const payrollActions = await import("@/lib/payroll/tenant-actions");
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
    await payrollActions.approveCommercialPayrollPreparation({
      periodId: "72000000-0000-4000-8000-000000000001",
      expectedRevision: 4,
      operationId: "74000000-0000-4000-8000-000000000004",
    }, mutationDependencies(calls) as never);

    expect(calls.map((call) => call.name)).toEqual([
      "approve_commercial_payroll_preparation_v2",
    ]);
  });

  it("uses v2 replace and reverse commands without a carry-forward option", async () => {
    const payrollActions = await import("@/lib/payroll/tenant-actions");
    const replace = Reflect.get(payrollActions, "replaceCommercialPayrollAdjustment") as unknown;
    const transition = Reflect.get(payrollActions, "transitionCommercialPayrollAdjustment") as unknown;
    expect(typeof replace).toBe("function");
    expect(typeof transition).toBe("function");
    if (typeof replace !== "function" || typeof transition !== "function") return;

    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
    const dependencies = mutationDependencies(calls);
    await replace({
      periodId: "72000000-0000-4000-8000-000000000001",
      expectedRevision: 4,
      operationId: "74000000-0000-4000-8000-000000000002",
      adjustmentId: "75000000-0000-4000-8000-000000000001",
      adjustmentMinutes: 20,
      reason: "Corrected paid handover total",
    }, dependencies);
    await transition({
      periodId: "72000000-0000-4000-8000-000000000001",
      expectedRevision: 4,
      operationId: "74000000-0000-4000-8000-000000000003",
      adjustmentId: "75000000-0000-4000-8000-000000000001",
      transition: "reverse",
      reason: "Manager reversed the earlier entry",
    }, dependencies);

    expect(calls.map((call) => call.name)).toEqual([
      "replace_commercial_payroll_adjustment_v2",
      "transition_commercial_payroll_adjustment_v2",
    ]);
    expect(calls[1].parameters).toMatchObject({ transition: "reverse" });
    expect(JSON.stringify(calls)).not.toContain("carry_forward");
  });
});
