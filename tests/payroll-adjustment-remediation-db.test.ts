// @vitest-environment node

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  ARRANGEMENT_A_HOURLY,
  ORG_A,
  SITE_A1,
  SITE_A2,
  STAFF_A,
  STAFF_A2,
  STAFF_B,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  acknowledgeWarnings,
  approvePreparation,
  blockedReadiness,
  createAdjustmentV2,
  createPayrollTenancyDatabase,
  createPeriod,
  hourlyRow,
  persistPreparation,
  recordExport,
  replaceAdjustmentV2,
  resetTenantDatabaseRole,
  salariedMalformedRow,
  setTenantAuthUser,
  transitionAdjustmentV2,
} from "./helpers/payroll-tenancy-db";

describe("payroll adjustment remediation database lifecycle", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createPayrollTenancyDatabase();
  }, 30_000);

  afterEach(async () => {
    if (db) await db.close();
  });

  async function preparedPeriod() {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const period = await createPeriod(db, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-09",
      operationId: randomUUID(),
    });
    const run = await persistPreparation(db, {
      periodId: String(period.periodId),
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(run).toMatchObject({ ok: true, revision: 1, status: "ready" });
    return { periodId: String(period.periodId), runId: String(run.runId) };
  }

  async function validatorAvailable() {
    await resetTenantDatabaseRole(db);
    const result = await db.query<{ signature: string | null }>(`
      select to_regprocedure(
        'private.validate_commercial_payroll_run_inputs(uuid,uuid)'
      )::text signature
    `);
    return result.rows[0].signature !== null;
  }

  async function validateRun(runId: string) {
    const result = await db.query<{
      is_fresh: boolean;
      stale_code: string | null;
      attendance_fingerprint: string;
      adjustment_fingerprint: string;
      pay_arrangement_fingerprint: string;
      site_scope_fingerprint: string;
      readiness_fingerprint: string;
      row_fingerprint: string;
      payable_minutes: number;
      adjustment_minutes: number;
    }>(`
      select * from private.validate_commercial_payroll_run_inputs($1::uuid,$2::uuid)
    `, [ORG_A, runId]);
    return result.rows[0];
  }

  async function snapshotCurrentAdjustments(input: { periodId: string; runId: string }) {
    await resetTenantDatabaseRole(db);
    await db.query(`
      insert into public.payroll_run_adjustment_snapshots (
        organisation_id,period_id,run_id,adjustment_id,lineage_root_id,staff_id,
        target_kind,site_id,operational_date,adjustment_minutes,reason,adjustment_created_at
      )
      select $1::uuid,$2::uuid,$3::uuid,effective.adjustment_id,effective.lineage_root_id,
        effective.staff_id,effective.target_kind,effective.site_id,effective.operational_date,
        effective.adjustment_minutes,effective.reason,effective.created_at
      from private.effective_commercial_payroll_adjustments($1::uuid,$2::uuid,$4::uuid,null) effective
      on conflict (organisation_id,run_id,adjustment_id) do nothing
    `, [ORG_A, input.periodId, input.runId, SITE_A1]);
    await db.query(`
      update public.payroll_preparation_runs
      set adjustment_fingerprint=private.payroll_effective_adjustment_fingerprint(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid
      )
      where organisation_id=$1::uuid and id=$4::uuid
    `, [ORG_A, input.periodId, SITE_A1, input.runId]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
  }

  async function loadRunReport(runId: string, requestedSiteId: string | null) {
    const result = await db.query<{ value: Record<string, unknown> }>(`
      select public.get_commercial_payroll_run_report($1::uuid,$2::uuid) value
    `, [runId, requestedSiteId]);
    return result.rows[0].value;
  }

  async function loadApprovedExport(approvalId: string, expectedRevision = 1) {
    const result = await db.query<{ value: Record<string, unknown> }>(`
      select public.get_commercial_approved_payroll_export($1::uuid,$2::integer) value
    `, [approvalId, expectedRevision]);
    return result.rows[0].value;
  }

  it("creates one stable active lineage and makes the unchanged run stale", async () => {
    const prepared = await preparedPeriod();
    const operationId = randomUUID();
    const input = {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId,
      target: {
        kind: "attendance" as const,
        staffId: STAFF_A,
        siteId: SITE_A1,
        operationalDate: "2026-08-03",
      },
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    };

    const created = await createAdjustmentV2(db, input);
    const retry = await createAdjustmentV2(db, input);
    const conflict = await createAdjustmentV2(db, { ...input, adjustmentMinutes: 20 });
    expect(created).toMatchObject({
      ok: true,
      code: "adjustment_created",
      revision: 1,
      adjustmentMinutes: 15,
    });
    expect(retry).toEqual({ ...created, code: "adjustment_reused", reused: true });
    expect(conflict).toEqual({ ok: false, code: "operation_conflict" });

    const second = await createAdjustmentV2(db, {
      ...input,
      operationId: randomUUID(),
      adjustmentMinutes: 10,
    });
    expect(second).toEqual({ ok: false, code: "run_stale" });

    await resetTenantDatabaseRole(db);
    const evidence = await db.query<{
      adjustment_id: string;
      lineage_root_id: string;
      staff_id: string;
      target_kind: string;
      site_id: string;
      operational_date: string;
      adjustment_minutes: number;
      live_count: number;
      snapshot_count: number;
    }>(`
      select effective.adjustment_id::text,effective.lineage_root_id::text,effective.staff_id,
        effective.target_kind,effective.site_id::text,effective.operational_date::text,
        effective.adjustment_minutes,
        (select count(*)::integer from private.effective_commercial_payroll_adjustments(
          $1::uuid,$2::uuid,$3::uuid,null
        )) live_count,
        (select count(*)::integer from private.effective_commercial_payroll_adjustments(
          $1::uuid,$2::uuid,$3::uuid,$4::uuid
        )) snapshot_count
      from private.effective_commercial_payroll_adjustments($1::uuid,$2::uuid,$3::uuid,null) effective
    `, [ORG_A, prepared.periodId, SITE_A1, prepared.runId]);
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]).toMatchObject({
      staff_id: STAFF_A,
      target_kind: "attendance",
      site_id: SITE_A1,
      operational_date: "2026-08-03",
      adjustment_minutes: 15,
      live_count: 1,
      snapshot_count: 0,
    });
    expect(evidence.rows[0].lineage_root_id).toBe(evidence.rows[0].adjustment_id);
  });

  it("returns stable validation and authorisation codes", async () => {
    const prepared = await preparedPeriod();
    const base = {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      target: {
        kind: "attendance" as const,
        staffId: STAFF_A,
        siteId: SITE_A1,
        operationalDate: "2026-08-03",
      },
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    };

    expect(await createAdjustmentV2(db, { ...base, expectedRevision: 99 }))
      .toEqual({ ok: false, code: "stale_revision", currentRevision: 1 });
    expect(await createAdjustmentV2(db, { ...base, operationId: randomUUID(), adjustmentMinutes: -511 }))
      .toEqual({ ok: false, code: "negative_target_total" });
    expect(await createAdjustmentV2(db, {
      ...base,
      operationId: randomUUID(),
      target: { ...base.target, staffId: STAFF_B },
    })).toEqual({ ok: false, code: "invalid_target" });
    expect(await createAdjustmentV2(db, {
      ...base,
      operationId: randomUUID(),
      target: { ...base.target, siteId: SITE_A2 },
    })).toEqual({ ok: false, code: "invalid_site_scope" });

    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    expect(await createAdjustmentV2(db, { ...base, operationId: randomUUID() }))
      .toEqual({ ok: false, code: "aal2_required" });
    await setTenantAuthUser(db, USER_A_SITE_MANAGER, "aal2");
    expect(await createAdjustmentV2(db, { ...base, operationId: randomUUID() }))
      .toEqual({ ok: false, code: "permission_denied" });
  });

  it("atomically replaces an active lineage once", async () => {
    const prepared = await preparedPeriod();
    const created = await createAdjustmentV2(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      target: { kind: "attendance", staffId: STAFF_A, siteId: SITE_A1, operationalDate: "2026-08-03" },
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    });
    await snapshotCurrentAdjustments(prepared);

    const operationId = randomUUID();
    const replacementInput = {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId,
      adjustmentId: String(created.adjustmentId),
      adjustmentMinutes: 20,
      reason: "Corrected paid handover total",
    };
    const replacement = await replaceAdjustmentV2(db, replacementInput);
    const retry = await replaceAdjustmentV2(db, replacementInput);
    expect(replacement).toMatchObject({ ok: true, code: "adjustment_replaced", adjustmentMinutes: 20 });
    expect(retry).toEqual({ ...replacement, code: "adjustment_reused", reused: true });

    await resetTenantDatabaseRole(db);
    const lineage = await db.query<{
      status: string;
      id: string;
      root_id: string;
      replaces_id: string | null;
      effective_count: number;
    }>(`
      select adjustment.status::text,adjustment.id::text,
        adjustment.lineage_root_id::text root_id,
        adjustment.replaces_adjustment_id::text replaces_id,
        (select count(*)::integer from private.effective_commercial_payroll_adjustments(
          $1::uuid,$2::uuid,$3::uuid,null
        )) effective_count
      from public.payroll_adjustments adjustment
      where adjustment.organisation_id=$1::uuid and adjustment.period_id=$2::uuid
      order by adjustment.created_at,adjustment.id
    `, [ORG_A, prepared.periodId, SITE_A1]);
    expect(lineage.rows).toHaveLength(2);
    expect(lineage.rows.map((row) => row.status).sort()).toEqual(["active", "superseded"]);
    expect(new Set(lineage.rows.map((row) => row.root_id))).toEqual(new Set([String(created.adjustmentId)]));
    expect(lineage.rows.find((row) => row.status === "active")).toMatchObject({
      replaces_id: String(created.adjustmentId),
      effective_count: 1,
    });
  });

  it("records reverse as superseded without a replacement", async () => {
    const prepared = await preparedPeriod();
    const created = await createAdjustmentV2(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      target: { kind: "attendance", staffId: STAFF_A, siteId: SITE_A1, operationalDate: "2026-08-03" },
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    });
    await snapshotCurrentAdjustments(prepared);

    const operationId = randomUUID();
    const transitionInput = {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId,
      adjustmentId: String(created.adjustmentId),
      transition: "reverse" as const,
      reason: "Manager reversed the earlier entry",
    };
    const reversed = await transitionAdjustmentV2(db, transitionInput);
    const retry = await transitionAdjustmentV2(db, transitionInput);
    expect(reversed).toMatchObject({ ok: true, code: "adjustment_reversed" });
    expect(retry).toEqual({ ...reversed, reused: true });

    await resetTenantDatabaseRole(db);
    const lifecycle = await db.query<{
      status: string;
      adjustment_count: number;
      effective_count: number;
      resolution: string;
      applied_adjustment_id: string | null;
    }>(`
      select adjustment.status::text,
        (select count(*)::integer from public.payroll_adjustments where period_id=$1::uuid) adjustment_count,
        (select count(*)::integer from private.effective_commercial_payroll_adjustments(
          $2::uuid,$1::uuid,$3::uuid,null
        )) effective_count,
        event.resolution,event.applied_adjustment_id::text
      from public.payroll_adjustments adjustment
      join public.payroll_adjustment_lifecycle_events event
        on event.organisation_id=adjustment.organisation_id and event.adjustment_id=adjustment.id
      where adjustment.period_id=$1::uuid
    `, [prepared.periodId, ORG_A, SITE_A1]);
    expect(lifecycle.rows).toEqual([{
      status: "superseded",
      adjustment_count: 1,
      effective_count: 0,
      resolution: "reverse",
      applied_adjustment_id: null,
    }]);
  });

  it("rejects browser-supplied adjustment minutes", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const period = await createPeriod(db, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-09",
      operationId: randomUUID(),
    });

    const result = await persistPreparation(db, {
      periodId: String(period.periodId),
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [{
        ...hourlyRow(),
        adjustmentMinutes: 15,
        payableMinutes: 525,
      }],
    });

    expect(result).toEqual({ ok: false, code: "client_adjustment_forbidden" });
  });

  it("composes each active lineage exactly once on every reprepare and snapshots the saved truth", async () => {
    const prepared = await preparedPeriod();
    const created = await createAdjustmentV2(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      target: {
        kind: "attendance",
        staffId: STAFF_A,
        siteId: SITE_A1,
        operationalDate: "2026-08-03",
      },
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    });
    expect(created).toMatchObject({ ok: true, code: "adjustment_created" });

    const second = await persistPreparation(db, {
      periodId: prepared.periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(second).toMatchObject({ ok: true, code: "preparation_persisted", revision: 2 });
    const third = await persistPreparation(db, {
      periodId: prepared.periodId,
      siteId: SITE_A1,
      expectedRevision: 2,
      operationId: randomUUID(),
    });
    expect(third).toMatchObject({ ok: true, code: "preparation_persisted", revision: 3 });

    await resetTenantDatabaseRole(db);
    const stored = await db.query<{
      revision: number;
      raw_minutes: number;
      adjustment_minutes: number;
      payable_minutes: number;
      snapshot_count: number;
      total_adjustment_minutes: number;
    }>(`
      select run.revision,row_value.raw_minutes,row_value.adjustment_minutes,
        row_value.payable_minutes,
        (select count(*)::integer from public.payroll_run_adjustment_snapshots snapshot
          where snapshot.organisation_id=run.organisation_id and snapshot.run_id=run.id) snapshot_count,
        run.adjustment_minutes_total::integer total_adjustment_minutes
      from public.payroll_preparation_runs run
      join public.payroll_preparation_rows row_value
        on row_value.organisation_id=run.organisation_id and row_value.run_id=run.id
      where run.organisation_id=$1::uuid and run.period_id=$2::uuid
        and run.revision in (2,3)
      order by run.revision,row_value.source_key
    `, [ORG_A, prepared.periodId]);
    expect(stored.rows).toEqual([
      {
        revision: 2,
        raw_minutes: 510,
        adjustment_minutes: 15,
        payable_minutes: 525,
        snapshot_count: 1,
        total_adjustment_minutes: 15,
      },
      {
        revision: 3,
        raw_minutes: 510,
        adjustment_minutes: 15,
        payable_minutes: 525,
        snapshot_count: 1,
        total_adjustment_minutes: 15,
      },
    ]);
  });

  it("accepts one stable selected-site summary for a uniquely assigned zero-attendance staff member", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const period = await createPeriod(db, {
      periodStart: "2026-08-10",
      periodEnd: "2026-08-16",
      operationId: randomUUID(),
    });
    const result = await persistPreparation(db, {
      periodId: String(period.periodId),
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow({
        siteId: SITE_A1,
        operationalDate: "2026-08-10",
        sourceKey: `staff-summary:${ORG_A}:${STAFF_A}:site:${SITE_A1}`,
        sourceKind: "staff_summary",
        rawMinutes: 0,
        payableMinutes: 0,
        ordinaryMinutes: 0,
        estimatedGrossValue: 0,
      })],
      readiness: {
        issues: [],
        counts: { blocker: 0, warning: 0, informational: 0 },
      },
    });

    expect(result).toMatchObject({ ok: true, code: "preparation_persisted", revision: 1 });
    await resetTenantDatabaseRole(db);
    const stored = await db.query<{ site_id: string; source_key: string; adjustment_minutes: number }>(`
      select site_id::text,source_key,adjustment_minutes
      from public.payroll_preparation_rows
      where organisation_id=$1::uuid and run_id=$2::uuid
    `, [ORG_A, String(result.runId)]);
    expect(stored.rows).toEqual([{
      site_id: SITE_A1,
      source_key: `staff-summary:${ORG_A}:${STAFF_A}:site:${SITE_A1}`,
      adjustment_minutes: 0,
    }]);
  });

  it("normalises a legacy selected-site summary so every approved row is reportable and exportable", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const period = await createPeriod(db, {
      periodStart: "2026-08-10",
      periodEnd: "2026-08-16",
      operationId: randomUUID(),
    });
    const prepared = await persistPreparation(db, {
      periodId: String(period.periodId),
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow({
        siteId: null,
        operationalDate: "2026-08-10",
        sourceKey: `staff-summary:${ORG_A}:${STAFF_A}:${ARRANGEMENT_A_HOURLY}`,
        sourceKind: "staff_summary",
        rawMinutes: 0,
        payableMinutes: 0,
        ordinaryMinutes: 0,
        estimatedGrossValue: 0,
      })],
      readiness: { issues: [], counts: { blocker: 0, warning: 0, informational: 0 } },
    });
    expect(prepared).toMatchObject({ ok: true, status: "ready", revision: 1 });
    if (!prepared.ok) return;

    const approval = await approvePreparation(db, {
      periodId: String(period.periodId),
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(approval).toMatchObject({ ok: true, code: "preparation_approved" });
    await resetTenantDatabaseRole(db);
    const stored = await db.query<{ id: string; site_id: string; source_key: string }>(`
      select id::text,site_id::text,source_key
      from public.payroll_preparation_rows
      where organisation_id=$1::uuid and run_id=$2::uuid
      order by id
    `, [ORG_A, String(prepared.runId)]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const report = await loadRunReport(String(prepared.runId), SITE_A1);
    const approvedExport = await loadApprovedExport(String(approval.approvalId));
    const reportIds = (report.rows as Array<Record<string, unknown>>)
      .map((row) => String(row.rowId)).sort();
    const exportIds = (approvedExport.rows as Array<Record<string, unknown>>)
      .map((row) => String(row.rowId)).sort();
    const storedIds = stored.rows.map((row) => row.id).sort();

    expect(stored.rows).toEqual([expect.objectContaining({
      site_id: SITE_A1,
      source_key: `staff-summary:${ORG_A}:${STAFF_A}:site:${SITE_A1}`,
    })]);
    expect(reportIds).toEqual(storedIds);
    expect(exportIds).toEqual(storedIds);
  });

  it("keeps an explicit site summary adjustment separate for multi-site staff", async () => {
    const prepared = await preparedPeriod();
    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.staff_site_assignments (
      organisation_id,staff_id,site_id,effective_from,is_primary,created_by_membership_id
    ) values ($1::uuid,$2,$3::uuid,'2026-08-01',false,
      'aa000000-0000-0000-0000-000000000001')`, [ORG_A, STAFF_A, SITE_A2]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const adjustment = await createAdjustmentV2(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      target: { kind: "site_summary", staffId: STAFF_A, siteId: SITE_A1 },
      adjustmentMinutes: 10,
      reason: "Confirmed selected-site opening duty",
    });
    expect(adjustment).toMatchObject({ ok: true, code: "adjustment_created" });
    const recalculated = await persistPreparation(db, {
      periodId: prepared.periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(recalculated).toMatchObject({ ok: true, revision: 2 });

    await resetTenantDatabaseRole(db);
    const rows = await db.query<{
      source_key: string;
      site_id: string;
      raw_minutes: number;
      adjustment_minutes: number;
      payable_minutes: number;
    }>(`
      select source_key,site_id::text,raw_minutes,adjustment_minutes,payable_minutes
      from public.payroll_preparation_rows where run_id=$1::uuid order by source_key
    `, [String(recalculated.runId)]);
    expect(rows.rows).toEqual([
      {
        source_key: `${ORG_A}:${STAFF_A}:2026-08-03:${SITE_A1}`,
        site_id: SITE_A1,
        raw_minutes: 510,
        adjustment_minutes: 0,
        payable_minutes: 510,
      },
      {
        source_key: `adjustment-summary:site:${ORG_A}:${STAFF_A}:${SITE_A1}`,
        site_id: SITE_A1,
        raw_minutes: 0,
        adjustment_minutes: 10,
        payable_minutes: 10,
      },
    ]);
  });

  it("offers an authorised site-summary target for A+B assigned zero-attendance staff", async () => {
    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.staff_site_assignments (
      organisation_id,staff_id,site_id,effective_from,is_primary,created_by_membership_id
    ) values ($1::uuid,$2,$3::uuid,'2026-08-01',false,
      'aa000000-0000-0000-0000-000000000001')`, [ORG_A, STAFF_A2, SITE_A1]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const period = await createPeriod(db, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-09",
      operationId: randomUUID(),
    });
    const prepared = await persistPreparation(db, {
      periodId: String(period.periodId),
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });

    const report = await loadRunReport(String(prepared.runId), SITE_A1);
    expect(report).toMatchObject({ ok: true, isFresh: true });
    expect(report.adjustmentTargets).toContainEqual({
      key: `site-summary:${STAFF_A2}:${SITE_A1}`,
      label: `Staff A2, Site A1, site summary`,
      target: {
        kind: "site_summary",
        staffId: STAFF_A2,
        siteId: SITE_A1,
        operationalDate: null,
      },
    });
  });

  it("blocks a payable multi-site zero-attendance adjustment until pay is applicable", async () => {
    const applicableArrangementId = randomUUID();
    await resetTenantDatabaseRole(db);
    await db.query(`delete from public.staff_pay_arrangements
      where organisation_id=$1::uuid and staff_id=$2`, [ORG_A, STAFF_A2]);
    await db.query(`insert into public.staff_site_assignments (
      organisation_id,staff_id,site_id,effective_from,is_primary,created_by_membership_id
    ) values ($1::uuid,$2,$3::uuid,'2026-08-01',false,
      'aa000000-0000-0000-0000-000000000001')`, [ORG_A, STAFF_A2, SITE_A1]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");

    const period = await createPeriod(db, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-09",
      operationId: randomUUID(),
    });
    const initial = await persistPreparation(db, {
      periodId: String(period.periodId),
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(initial).toMatchObject({ ok: true, status: "ready", revision: 1 });

    const adjustment = await createAdjustmentV2(db, {
      periodId: String(period.periodId),
      expectedRevision: 1,
      operationId: randomUUID(),
      target: { kind: "site_summary", staffId: STAFF_A2, siteId: SITE_A1 },
      adjustmentMinutes: 60,
      reason: "Confirmed selected-site paid duty",
    });
    expect(adjustment).toMatchObject({ ok: true, code: "adjustment_created" });
    const blocked = await persistPreparation(db, {
      periodId: String(period.periodId),
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });

    await resetTenantDatabaseRole(db);
    const blockedEvidence = await db.query<{
      status: string;
      blocker_count: number;
      readiness: { issues: Array<Record<string, unknown>> };
      pay_arrangement_id: string | null;
      payable_minutes: number;
      warnings: string[];
    }>(`
      select run.status::text,run.blocker_count,run.readiness,
        row_value.pay_arrangement_id::text,row_value.payable_minutes,row_value.warnings
      from public.payroll_preparation_runs run
      join public.payroll_preparation_rows row_value
        on row_value.organisation_id=run.organisation_id and row_value.run_id=run.id
      where run.organisation_id=$1::uuid and run.id=$2::uuid
        and left(row_value.source_key,19)='adjustment-summary:'
    `, [ORG_A, String(blocked.runId)]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const deniedApproval = await approvePreparation(db, {
      periodId: String(period.periodId),
      expectedRevision: 2,
      operationId: randomUUID(),
    });
    const unavailableExport = await loadApprovedExport(randomUUID(), 2);
    await resetTenantDatabaseRole(db);
    const approvalCountBeforePay = await db.query<{ count: number }>(`
      select count(*)::integer count from public.payroll_approvals
      where organisation_id=$1::uuid and period_id=$2::uuid
    `, [ORG_A, String(period.periodId)]);

    await db.query(`insert into public.staff_pay_arrangements (
      id,staff_id,pay_type,hourly_rate,annual_salary,monthly_salary,
      contracted_weekly_hours,standard_daily_hours,overtime_multiplier,
      effective_from,effective_to,is_active,created_by,updated_by
    ) values ($1::uuid,$2,'hourly',14,null,null,40,8,1.5,
      '2026-08-01',null,true,$3,$3)`,
    [applicableArrangementId, STAFF_A2, "99000000-0000-0000-0000-000000000001"]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const ready = await persistPreparation(db, {
      periodId: String(period.periodId),
      siteId: SITE_A1,
      expectedRevision: 2,
      operationId: randomUUID(),
    });
    await acknowledgeWarnings(db, {
      periodId: String(period.periodId),
      expectedRevision: 3,
      operationId: randomUUID(),
      warningCodes: ["unreviewed_day"],
      note: "Reviewed the attendance evidence before approval",
    });
    const approval = await approvePreparation(db, {
      periodId: String(period.periodId),
      expectedRevision: 3,
      operationId: randomUUID(),
    });
    const approvedExport = await loadApprovedExport(String(approval.approvalId), 3);
    const recordedExport = await recordExport(db, {
      periodId: String(period.periodId),
      approvalId: String(approval.approvalId),
      expectedRevision: 3,
      operationId: randomUUID(),
    });
    await resetTenantDatabaseRole(db);
    const storedReadyRows = await db.query<{
      id: string;
      source_key: string;
      pay_arrangement_id: string | null;
      warnings: string[];
    }>(`
      select id::text,source_key,pay_arrangement_id::text,warnings
      from public.payroll_preparation_rows
      where organisation_id=$1::uuid and run_id=$2::uuid order by id
    `, [ORG_A, String(ready.runId)]);

    expect(blocked).toMatchObject({
      ok: true, status: "needs_review", revision: 2, blockerCount: 1,
    });
    expect(blockedEvidence.rows).toEqual([expect.objectContaining({
      status: "needs_review",
      blocker_count: 1,
      pay_arrangement_id: null,
      payable_minutes: 60,
      warnings: [],
    })]);
    expect(blockedEvidence.rows[0].readiness.issues).toContainEqual(expect.objectContaining({
      code: "missing_pay_arrangement",
      severity: "blocker",
      staffId: STAFF_A2,
      siteId: SITE_A1,
    }));
    expect(deniedApproval).toEqual({ ok: false, code: "blockers_present" });
    expect(unavailableExport).toEqual({ ok: false, code: "not_found" });
    expect(approvalCountBeforePay.rows[0].count).toBe(0);

    expect(ready).toMatchObject({ ok: true, status: "ready", revision: 3, blockerCount: 0 });
    expect(approval).toMatchObject({ ok: true, code: "preparation_approved", revision: 3 });
    expect(approvedExport).toMatchObject({
      ok: true, payableMinutes: 570, adjustmentMinutes: 60,
    });
    expect((approvedExport.rows as Array<Record<string, unknown>>)
      .map((row) => String(row.rowId)).sort())
      .toEqual(storedReadyRows.rows.map((row) => row.id).sort());
    expect(storedReadyRows.rows).toContainEqual(expect.objectContaining({
      source_key: `adjustment-summary:site:${ORG_A}:${STAFF_A2}:${SITE_A1}`,
      pay_arrangement_id: applicableArrangementId,
      warnings: [],
    }));
    expect(recordedExport).toMatchObject({ ok: true, code: "export_recorded", revision: 3 });
  });

  it("exposes the complete freshness evidence contract and starts fresh", async () => {
    expect(await validatorAvailable()).toBe(true);
    if (!(await validatorAvailable())) return;
    const prepared = await preparedPeriod();
    await resetTenantDatabaseRole(db);
    const validation = await validateRun(prepared.runId);

    expect(validation).toMatchObject({
      is_fresh: true,
      stale_code: null,
      payable_minutes: 510,
      adjustment_minutes: 0,
    });
    for (const fingerprint of [
      validation.attendance_fingerprint,
      validation.adjustment_fingerprint,
      validation.pay_arrangement_fingerprint,
      validation.site_scope_fingerprint,
      validation.readiness_fingerprint,
      validation.row_fingerprint,
    ]) expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("detects attendance, adjustment and pay-arrangement drift independently", async () => {
    expect(await validatorAvailable()).toBe(true);
    if (!(await validatorAvailable())) return;

    let prepared = await preparedPeriod();
    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.clock_events (
      organisation_id,site_id,staff_id,event_type,event_timestamp,event_source
    ) values ($1::uuid,$2::uuid,$3,'clock_out','2026-08-03T17:00:00+01:00','kiosk')`,
    [ORG_A, SITE_A1, STAFF_A]);
    expect(await validateRun(prepared.runId)).toMatchObject({
      is_fresh: false, stale_code: "stale_attendance_fingerprint",
    });

    await db.close();
    db = await createPayrollTenancyDatabase();
    prepared = await preparedPeriod();
    await createAdjustmentV2(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      target: { kind: "attendance", staffId: STAFF_A, siteId: SITE_A1, operationalDate: "2026-08-03" },
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    });
    await resetTenantDatabaseRole(db);
    expect(await validateRun(prepared.runId)).toMatchObject({
      is_fresh: false, stale_code: "stale_adjustment_fingerprint",
    });

    await db.close();
    db = await createPayrollTenancyDatabase();
    prepared = await preparedPeriod();
    await resetTenantDatabaseRole(db);
    await db.query(`update public.staff_pay_arrangements set hourly_rate=13
      where organisation_id=$1::uuid and staff_id=$2`, [ORG_A, STAFF_A]);
    expect(await validateRun(prepared.runId)).toMatchObject({
      is_fresh: false, stale_code: "stale_pay_arrangement_fingerprint",
    });
  }, 30_000);

  it("rejects approval when a complete occurrence appears on a previously absent date", async () => {
    const prepared = await preparedPeriod();
    await acknowledgeWarnings(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      warningCodes: ["unreviewed_day"],
      note: "Reviewed the originally prepared attendance date",
    });
    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.clock_events (
      organisation_id,site_id,staff_id,event_type,event_timestamp,event_source
    ) values
      ($1::uuid,$2::uuid,$3,'clock_in','2026-08-04T08:00:00+01:00','kiosk'),
      ($1::uuid,$2::uuid,$3,'clock_out','2026-08-04T16:00:00+01:00','kiosk')`,
    [ORG_A, SITE_A1, STAFF_A]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");

    expect(await approvePreparation(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
    })).toEqual({ ok: false, code: "stale_attendance_fingerprint" });
  });

  it("rejects export when a previously zero-attendance employee gains an occurrence", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const period = await createPeriod(db, {
      periodStart: "2026-08-10",
      periodEnd: "2026-08-16",
      operationId: randomUUID(),
    });
    const prepared = await persistPreparation(db, {
      periodId: String(period.periodId),
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow({
        siteId: SITE_A1,
        operationalDate: "2026-08-10",
        sourceKey: `staff-summary:${ORG_A}:${STAFF_A}:site:${SITE_A1}`,
        sourceKind: "staff_summary",
        rawMinutes: 0,
        payableMinutes: 0,
        ordinaryMinutes: 0,
        estimatedGrossValue: 0,
      })],
      readiness: { issues: [], counts: { blocker: 0, warning: 0, informational: 0 } },
    });
    const approval = await approvePreparation(db, {
      periodId: String(period.periodId),
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(approval).toMatchObject({ ok: true, code: "preparation_approved" });
    const approvedBefore = await loadApprovedExport(String(approval.approvalId));
    expect(approvedBefore).toMatchObject({ ok: true, payableMinutes: 0 });

    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.clock_events (
      organisation_id,site_id,staff_id,event_type,event_timestamp,event_source
    ) values
      ($1::uuid,$2::uuid,$3,'clock_in','2026-08-11T08:00:00+01:00','kiosk'),
      ($1::uuid,$2::uuid,$3,'clock_out','2026-08-11T16:00:00+01:00','kiosk')`,
    [ORG_A, SITE_A1, STAFF_A]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");

    const exportRead = await loadApprovedExport(String(approval.approvalId));
    const rows = approvedBefore.rows as Array<Record<string, unknown>>;
    const auditWrite = await db.query<{ value: Record<string, unknown> }>(`
      select public.record_commercial_payroll_export_v2(
        $1::uuid,$2::uuid,1,$3::uuid,'xlsx','payroll.xlsx',$4,$5::integer,$6,$7::bigint,$8::bigint
      ) value
    `, [
      String(period.periodId),
      String(approval.approvalId),
      randomUUID(),
      "e".repeat(64),
      rows.length,
      String(approvedBefore.rowFingerprint),
      Number(approvedBefore.payableMinutes),
      Number(approvedBefore.adjustmentMinutes),
    ]);

    expect(exportRead).toEqual({ ok: false, code: "stale_attendance_fingerprint" });
    expect(auditWrite.rows[0].value).toEqual({
      ok: false,
      code: "stale_attendance_fingerprint",
    });
    expect(prepared).toMatchObject({ ok: true, revision: 1 });
  });

  it("detects newly eligible staff and assignment drift outside stored run rows", async () => {
    expect(await validatorAvailable()).toBe(true);
    if (!(await validatorAvailable())) return;
    let prepared = await preparedPeriod();
    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.staff_profiles (
        id,organisation_id,full_name,display_name,employment_role,active
      ) values ('staff-c',$1::uuid,'Staff C','Staff C','Practitioner',true)`, [ORG_A]);
    await db.query(`insert into public.staff_site_assignments (
        organisation_id,staff_id,site_id,effective_from,is_primary,created_by_membership_id
      ) values ($1::uuid,'staff-c',$2::uuid,'2026-08-01',true,
        'aa000000-0000-0000-0000-000000000001')`, [ORG_A, SITE_A1]);
    expect(await validateRun(prepared.runId)).toMatchObject({
      is_fresh: false, stale_code: "stale_site_scope_fingerprint",
    });

    await db.close();
    db = await createPayrollTenancyDatabase();
    prepared = await preparedPeriod();
    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.staff_site_assignments (
      organisation_id,staff_id,site_id,effective_from,is_primary,created_by_membership_id
    ) values ($1::uuid,$2,$3::uuid,'2026-08-01',false,
      'aa000000-0000-0000-0000-000000000001')`, [ORG_A, STAFF_A, SITE_A2]);
    expect(await validateRun(prepared.runId)).toMatchObject({
      is_fresh: false, stale_code: "stale_site_scope_fingerprint",
    });
  }, 30_000);

  it("detects readiness, period revision and stored row drift independently", async () => {
    expect(await validatorAvailable()).toBe(true);
    if (!(await validatorAvailable())) return;
    let prepared = await preparedPeriod();
    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.attendance_day_reviews (
      organisation_id,site_id,staff_id,review_date,status,reason,
      reviewed_by_membership_id,reviewed_at
    ) values ($1::uuid,$2::uuid,$3,'2026-08-03','approved','Reviewed attendance',
      'aa000000-0000-0000-0000-000000000001',now())`, [ORG_A, SITE_A1, STAFF_A]);
    expect(await validateRun(prepared.runId)).toMatchObject({
      is_fresh: false, stale_code: "stale_readiness",
    });

    await db.close();
    db = await createPayrollTenancyDatabase();
    prepared = await preparedPeriod();
    await resetTenantDatabaseRole(db);
    await db.query(`update public.payroll_periods set revision=revision+1
      where organisation_id=$1::uuid and id=$2::uuid`, [ORG_A, prepared.periodId]);
    expect(await validateRun(prepared.runId)).toMatchObject({
      is_fresh: false, stale_code: "stale_period_revision",
    });

    await db.close();
    db = await createPayrollTenancyDatabase();
    prepared = await preparedPeriod();
    await resetTenantDatabaseRole(db);
    await db.query(`update public.payroll_preparation_rows set estimated_gross_value=999
      where organisation_id=$1::uuid and run_id=$2::uuid`, [ORG_A, prepared.runId]);
    expect(await validateRun(prepared.runId)).toMatchObject({
      is_fresh: false, stale_code: "stale_row_fingerprint",
    });
  }, 30_000);

  it("approves only through v2 and copies every validated evidence field", async () => {
    expect(await validatorAvailable()).toBe(true);
    if (!(await validatorAvailable())) return;
    const prepared = await preparedPeriod();
    await acknowledgeWarnings(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      warningCodes: ["unreviewed_day"],
      note: "Reviewed before final approval",
    });
    const approval = await db.query<{ value: Record<string, unknown> }>(`
      select public.approve_commercial_payroll_preparation_v2(
        $1::uuid,$2::integer,$3::uuid
      ) value
    `, [prepared.periodId, 1, randomUUID()]);
    expect(approval.rows[0].value).toMatchObject({
      ok: true, code: "preparation_approved", revision: 1,
    });

    await resetTenantDatabaseRole(db);
    const evidence = await db.query<Record<string, unknown>>(`
      select approval.attendance_fingerprint,approval.adjustment_fingerprint,
        approval.pay_arrangement_fingerprint,approval.site_scope_fingerprint,
        approval.readiness_fingerprint,approval.row_fingerprint,
        approval.payable_minutes_total::integer,approval.adjustment_minutes_total::integer
      from public.payroll_approvals approval
      where approval.id=$1::uuid
    `, [String(approval.rows[0].value.approvalId)]);
    expect(evidence.rows[0]).toEqual(expect.objectContaining({
      payable_minutes_total: 510,
      adjustment_minutes_total: 0,
    }));
    expect(Object.values(evidence.rows[0]).filter((value) => typeof value === "string"))
      .toHaveLength(6);

    const grants = await db.query<{ routine_name: string; grantee: string }>(`
      select routine_name,grantee from information_schema.routine_privileges
      where routine_schema='public'
        and routine_name in (
          'approve_commercial_payroll_preparation',
          'approve_commercial_payroll_preparation_v2'
        )
    `);
    expect(grants.rows).toContainEqual({
      routine_name: "approve_commercial_payroll_preparation_v2",
      grantee: "authenticated",
    });
    expect(grants.rows).not.toContainEqual({
      routine_name: "approve_commercial_payroll_preparation",
      grantee: "authenticated",
    });
  });

  it("guards run reports by exact organisation or site scope without leaking source keys", async () => {
    const sitePrepared = await preparedPeriod();
    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.membership_role_assignments (
      organisation_id,membership_id,role,scope_type,site_id,granted_by_membership_id
    ) values ($1::uuid,'aa000000-0000-0000-0000-000000000003',
      'payroll_admin','site',$2::uuid,'aa000000-0000-0000-0000-000000000001')`,
    [ORG_A, SITE_A1]);
    await setTenantAuthUser(db, USER_A_SITE_MANAGER, "aal2");
    const siteReport = await loadRunReport(sitePrepared.runId, SITE_A1);
    expect(siteReport).toMatchObject({ ok: true, code: "report_loaded", isFresh: true });
    const siteRows = siteReport.rows as Array<Record<string, unknown>>;
    expect(siteRows).toHaveLength(1);
    expect(siteRows.every((row) => row.siteId === SITE_A1)).toBe(true);
    expect(JSON.stringify(siteReport)).not.toContain("sourceKey");
    expect(JSON.stringify(siteReport)).not.toContain("source_key");

    await db.close();
    db = await createPayrollTenancyDatabase();
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const period = await createPeriod(db, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-09",
      operationId: randomUUID(),
    });
    const organisationRun = await persistPreparation(db, {
      periodId: String(period.periodId),
      siteId: null,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow(), salariedMalformedRow()],
      readiness: blockedReadiness(),
    });
    expect(organisationRun).toMatchObject({ ok: true, status: "needs_review" });
    const organisationReport = await loadRunReport(String(organisationRun.runId), null);
    expect(organisationReport).toMatchObject({
      ok: true,
      code: "report_loaded",
      organisationId: ORG_A,
      isFresh: true,
    });

    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.membership_role_assignments (
      organisation_id,membership_id,role,scope_type,site_id,granted_by_membership_id
    ) values ($1::uuid,'aa000000-0000-0000-0000-000000000003',
      'payroll_admin','site',$2::uuid,'aa000000-0000-0000-0000-000000000001')`,
    [ORG_A, SITE_A1]);
    await setTenantAuthUser(db, USER_A_SITE_MANAGER, "aal2");
    const denied = await loadRunReport(String(organisationRun.runId), null);
    const guessedRun = await loadRunReport(randomUUID(), null);
    const guessedSite = await loadRunReport(String(organisationRun.runId), randomUUID());
    expect(denied).toEqual({ ok: false, code: "not_found" });
    expect(guessedRun).toEqual(denied);
    expect(guessedSite).toEqual(denied);
  }, 30_000);

  it("returns and records only an exact fresh approved export with reconciled evidence", async () => {
    const prepared = await preparedPeriod();
    await acknowledgeWarnings(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      warningCodes: ["unreviewed_day"],
      note: "Reviewed before the approved export",
    });
    const approval = await approvePreparation(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(approval).toMatchObject({ ok: true, code: "preparation_approved" });

    const approvedExport = await loadApprovedExport(String(approval.approvalId));
    expect(approvedExport).toMatchObject({
      ok: true,
      code: "approved_export_loaded",
      revision: 1,
      rowFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      payableMinutes: 510,
      adjustmentMinutes: 0,
    });
    const exportRows = approvedExport.rows as Array<Record<string, unknown>>;
    expect(exportRows.reduce((sum, row) => sum + Number(row.payableMinutes), 0)).toBe(510);
    expect(exportRows.reduce((sum, row) => sum + Number(row.adjustmentMinutes), 0)).toBe(0);
    const snapshots = approvedExport.adjustmentSnapshots as Array<Record<string, unknown>>;
    expect(new Set(snapshots.map((row) => row.adjustmentId)).size).toBe(snapshots.length);

    const operationId = randomUUID();
    const recordInput = [
      prepared.periodId,
      String(approval.approvalId),
      1,
      operationId,
      "xlsx",
      "organisation-a-site-a1-payroll-2026-08-03-to-2026-08-09-r1.xlsx",
      "e".repeat(64),
      exportRows.length,
      String(approvedExport.rowFingerprint),
      Number(approvedExport.payableMinutes),
      Number(approvedExport.adjustmentMinutes),
    ];
    const recorded = await db.query<{ value: Record<string, unknown> }>(`
      select public.record_commercial_payroll_export_v2(
        $1::uuid,$2::uuid,$3::integer,$4::uuid,$5::public.payroll_export_format,
        $6,$7,$8::integer,$9,$10::bigint,$11::bigint
      ) value
    `, recordInput);
    expect(recorded.rows[0].value).toMatchObject({ ok: true, code: "export_recorded" });

    await resetTenantDatabaseRole(db);
    const audit = await db.query<Record<string, unknown>>(`
      select audit.site_id::text,audit.row_count,audit.file_name,audit.file_sha256,
        audit.attendance_fingerprint,audit.adjustment_fingerprint,
        audit.pay_arrangement_fingerprint,audit.site_scope_fingerprint,
        audit.readiness_fingerprint,audit.row_fingerprint,
        audit.payable_minutes_total::integer,audit.adjustment_minutes_total::integer
      from public.payroll_export_audits audit where audit.operation_id=$1::uuid
    `, [operationId]);
    expect(audit.rows[0]).toEqual(expect.objectContaining({
      site_id: SITE_A1,
      row_count: exportRows.length,
      file_name: recordInput[5],
      file_sha256: "e".repeat(64),
      row_fingerprint: approvedExport.rowFingerprint,
      payable_minutes_total: 510,
      adjustment_minutes_total: 0,
    }));
    expect(Object.values(audit.rows[0]).filter((value) =>
      typeof value === "string" && /^[0-9a-f]{64}$/.test(value),
    )).toHaveLength(7);

    const grants = await db.query<{ routine_name: string; grantee: string }>(`
      select routine_name,grantee from information_schema.routine_privileges
      where routine_schema='public' and routine_name in (
        'record_commercial_payroll_export','record_commercial_payroll_export_v2'
      )
    `);
    expect(grants.rows).toContainEqual({
      routine_name: "record_commercial_payroll_export_v2",
      grantee: "authenticated",
    });
    expect(grants.rows).not.toContainEqual({
      routine_name: "record_commercial_payroll_export",
      grantee: "authenticated",
    });
  }, 30_000);

  it("denies approved export reads and audit writes after protected evidence becomes stale", async () => {
    const prepared = await preparedPeriod();
    await acknowledgeWarnings(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      warningCodes: ["unreviewed_day"],
      note: "Reviewed before the approved export",
    });
    const approval = await approvePreparation(db, {
      periodId: prepared.periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.clock_events (
      organisation_id,site_id,staff_id,event_type,event_timestamp,event_source
    ) values ($1::uuid,$2::uuid,$3,'clock_out','2026-08-03T17:00:00+01:00','kiosk')`,
    [ORG_A, SITE_A1, STAFF_A]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");

    expect(await loadApprovedExport(String(approval.approvalId))).toEqual({
      ok: false,
      code: "stale_attendance_fingerprint",
    });
    const recorded = await db.query<{ value: Record<string, unknown> }>(`
      select public.record_commercial_payroll_export_v2(
        $1::uuid,$2::uuid,1,$3::uuid,'xlsx','payroll.xlsx',$4,1,$5,510,0
      ) value
    `, [
      prepared.periodId,
      String(approval.approvalId),
      randomUUID(),
      "e".repeat(64),
      "d".repeat(64),
    ]);
    expect(recorded.rows[0].value).toEqual({
      ok: false,
      code: "stale_attendance_fingerprint",
    });
  }, 30_000);
});
