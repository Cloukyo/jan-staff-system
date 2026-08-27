import { describe, expect, it } from "vitest";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import { resolveMembershipContext } from "@/lib/commercial-identity/context";
import { resolvePayrollActor } from "@/lib/payroll/actor";
import {
  loadCommercialPayrollWorkspace,
  type CommercialPayrollRepository,
} from "@/lib/payroll/tenant-server";
import {
  createCommercialPayrollPeriod,
  executeCommercialPayrollMutation,
  recordCommercialPayrollExport,
} from "@/lib/payroll/tenant-actions";
import type {
  CommercialIdentitySnapshot,
  CommercialMembershipContext,
} from "@/types/tenancy";

const ORGANISATION_A = "10000000-0000-4000-8000-000000000000";
const ORGANISATION_B = "20000000-0000-4000-8000-000000000000";
const SITE_A = "11000000-0000-4000-8000-000000000000";
const MEMBERSHIP_A = "31000000-0000-4000-8000-000000000000";

function membershipContext(
  overrides: Partial<CommercialMembershipContext> = {},
): CommercialMembershipContext {
  return {
    membershipId: MEMBERSHIP_A,
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
    sitePermissions: {
      [SITE_A]: ["payroll.read", "payroll.prepare", "payroll.export"],
    },
    selectedSiteId: SITE_A,
    permittedSiteIds: [SITE_A],
    permissions: ["payroll.read", "payroll.prepare", "payroll.export"],
    ...overrides,
  };
}

function identity(aal: "aal1" | "aal2" = "aal2"): CommercialIdentitySnapshot {
  const context = membershipContext();
  return {
    authUserId: "user-a",
    email: "fictional.manager@example.test",
    aal,
    memberships: [{
      membershipId: context.membershipId,
      organisationId: context.organisationId,
      organisationDisplayName: context.organisationDisplayName,
      organisationStatus: context.organisationStatus,
      organisationArchived: context.organisationArchived,
      status: context.status,
      active: context.active,
      staffId: context.staffId,
      authorisationRevision: context.authorisationRevision,
      roles: context.roles,
      siteAccess: context.siteAccess,
      permissions: context.permissions,
      sitePermissions: context.sitePermissions,
    }],
  };
}

describe("payroll commercial compatibility actor", () => {
  it("uses commercial membership authority without consulting Jan legacy accounts", async () => {
    let legacyCalls = 0;
    const context = membershipContext();

    await expect(resolvePayrollActor({
      loadCommercial: async () => context,
      loadJanLegacy: async () => {
        legacyCalls += 1;
        return { id: "legacy-manager" };
      },
    })).resolves.toEqual({ kind: "commercial", context });
    expect(legacyCalls).toBe(0);
  });

  it("fails closed for multi-organisation ambiguity and permission failures", async () => {
    for (const code of ["organisation_selection_required", "permission_denied"] as const) {
      let legacyCalls = 0;
      await expect(resolvePayrollActor({
        loadCommercial: async () => { throw new CommercialIdentityError(code); },
        loadJanLegacy: async () => {
          legacyCalls += 1;
          return { id: "legacy-manager" };
        },
      })).rejects.toMatchObject({ code });
      expect(legacyCalls).toBe(0);
    }
  });

  it("uses the explicit Jan adapter only for a genuine membership_required result", async () => {
    await expect(resolvePayrollActor({
      loadCommercial: async () => { throw new CommercialIdentityError("membership_required"); },
      loadJanLegacy: async () => ({ id: "jan-manager" }),
    })).resolves.toEqual({ kind: "jan_legacy", account: { id: "jan-manager" } });

    await expect(resolvePayrollActor({
      loadCommercial: async () => { throw new Error("identity store unavailable"); },
      loadJanLegacy: async () => ({ id: "jan-manager" }),
    })).rejects.toThrow("identity store unavailable");
  });

  it("does not convert an invalid selected site into Jan manager access", async () => {
    let legacyCalls = 0;
    const currentIdentity = identity();
    await expect(resolvePayrollActor({
      loadCommercial: async () => resolveMembershipContext(currentIdentity, {
        requestedMembershipId: MEMBERSHIP_A,
        requestedSiteId: "19000000-0000-4000-8000-000000000000",
        selectionMode: "sensitive",
      }),
      loadJanLegacy: async () => {
        legacyCalls += 1;
        return { id: "legacy-manager" };
      },
    })).rejects.toMatchObject({ code: "site_unavailable" });
    expect(legacyCalls).toBe(0);
  });
});

describe("commercial payroll workspace", () => {
  it("passes only the server-resolved organisation and selected site to every loader", async () => {
    const scopes: Array<{ organisationId: string; siteId: string | null }> = [];
    const recordScope = async (scope: { organisationId: string; siteId: string | null }) => {
      scopes.push(scope);
      return [];
    };
    const repository: CommercialPayrollRepository = {
      loadStaff: recordScope,
      loadPayArrangements: recordScope,
      loadEffectiveEvents: recordScope,
      loadAttendanceReviews: recordScope,
      loadAttendanceExceptions: recordScope,
      loadAttendanceRequests: recordScope,
      loadRotaShifts: recordScope,
    };

    const workspace = await loadCommercialPayrollWorkspace(
      membershipContext(),
      { periodStart: "2026-08-01", periodEnd: "2026-08-07" },
      repository,
    );

    expect(scopes).toHaveLength(7);
    expect(scopes).toEqual(Array(7).fill({
      organisationId: ORGANISATION_A,
      siteId: SITE_A,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-07",
    }));
    expect(workspace.snapshot.organisationId).toBe(ORGANISATION_A);
    expect(workspace.rotaShifts).toEqual([]);
  });

  it("rejects a forged site context before querying payroll data", async () => {
    let loaderCalls = 0;
    const called = async () => {
      loaderCalls += 1;
      return [];
    };
    const repository: CommercialPayrollRepository = {
      loadStaff: called,
      loadPayArrangements: called,
      loadEffectiveEvents: called,
      loadAttendanceReviews: called,
      loadAttendanceExceptions: called,
      loadAttendanceRequests: called,
      loadRotaShifts: called,
    };

    await expect(loadCommercialPayrollWorkspace(
      membershipContext({ selectedSiteId: "foreign-site" }),
      { periodStart: "2026-08-01", periodEnd: "2026-08-07" },
      repository,
    )).rejects.toMatchObject({ code: "site_unavailable" });
    expect(loaderCalls).toBe(0);
  });
});

describe("commercial payroll mutations", () => {
  it("rejects AAL1 before invoking a payroll RPC", async () => {
    let rpcCalls = 0;
    await expect(executeCommercialPayrollMutation({
      identity: identity("aal1"),
      context: membershipContext(),
      permission: "payroll.prepare",
      command: async () => {
        rpcCalls += 1;
        return { ok: true, code: "unexpected" };
      },
    })).rejects.toMatchObject({ code: "mfa_required" });
    expect(rpcCalls).toBe(0);
  });

  it("does not let a permission failure fall through to a command", async () => {
    let rpcCalls = 0;
    await expect(executeCommercialPayrollMutation({
      identity: identity(),
      context: membershipContext({ permissions: ["payroll.read"] }),
      permission: "payroll.prepare",
      command: async () => {
        rpcCalls += 1;
        return { ok: true, code: "unexpected" };
      },
    })).rejects.toMatchObject({ code: "permission_denied" });
    expect(rpcCalls).toBe(0);
  });

  it("passes server-derived commercial context to an authorised command", async () => {
    const result = await executeCommercialPayrollMutation({
      identity: identity(),
      context: membershipContext(),
      permission: "payroll.prepare",
      command: async (scope) => ({
        ok: true,
        code: "period_created",
        organisationId: scope.organisationId,
        membershipId: scope.membershipId,
        siteId: scope.siteId,
      }),
    });

    expect(result).toEqual({
      ok: true,
      code: "period_created",
      organisationId: ORGANISATION_A,
      membershipId: MEMBERSHIP_A,
      siteId: SITE_A,
    });
    expect(result.organisationId).not.toBe(ORGANISATION_B);
  });

  it("derives the organisation for period creation and passes the bound operation ID", async () => {
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
    let revalidations = 0;
    const result = await createCommercialPayrollPeriod({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      operationId: "71000000-0000-4000-8000-000000000001",
    }, {
      loadAuthorisation: async () => ({
        identity: identity(),
        context: membershipContext(),
      }),
      rpc: async (name, parameters) => {
        calls.push({ name, parameters });
        return { data: { ok: true, code: "period_created" }, error: null };
      },
      revalidate: () => { revalidations += 1; },
    });

    expect(result).toEqual({ ok: true, code: "period_created" });
    expect(calls).toEqual([{
      name: "create_commercial_payroll_period",
      parameters: {
        target_organisation_id: ORGANISATION_A,
        target_period_start: "2026-08-01",
        target_period_end: "2026-08-31",
        target_operation_id: "71000000-0000-4000-8000-000000000001",
      },
    }]);
    expect(revalidations).toBe(1);
  });

  it("uses the v2 revision-safe export contract with approved evidence", async () => {
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
    await recordCommercialPayrollExport({
      periodId: "72000000-0000-4000-8000-000000000001",
      approvalId: "73000000-0000-4000-8000-000000000001",
      expectedRevision: 4,
      operationId: "74000000-0000-4000-8000-000000000001",
      format: "csv",
      fileName: "commercial-payroll.csv",
      contentSha256: "a".repeat(64),
      rowCount: 12,
      rowFingerprint: "b".repeat(64),
      payableMinutes: 5_400,
      adjustmentMinutes: 30,
    }, {
      loadAuthorisation: async () => ({
        identity: identity(),
        context: membershipContext(),
      }),
      rpc: async (name, parameters) => {
        calls.push({ name, parameters });
        return { data: { ok: true, code: "export_recorded" }, error: null };
      },
      revalidate: () => undefined,
    });

    expect(calls).toEqual([{
      name: "record_commercial_payroll_export_v2",
      parameters: {
        target_period_id: "72000000-0000-4000-8000-000000000001",
        target_approval_id: "73000000-0000-4000-8000-000000000001",
        expected_revision: 4,
        target_operation_id: "74000000-0000-4000-8000-000000000001",
        target_export_format: "csv",
        target_file_name: "commercial-payroll.csv",
        target_file_sha256: "a".repeat(64),
        target_row_count: 12,
        target_row_fingerprint: "b".repeat(64),
        target_payable_minutes: 5_400,
        target_adjustment_minutes: 30,
      },
    }]);
  });
});
