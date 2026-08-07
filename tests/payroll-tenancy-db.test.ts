// @vitest-environment node

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  ARRANGEMENT_A_HOURLY,
  ARRANGEMENT_B_HOURLY,
  CORRECTION_A_CLOCK_OUT,
  EVENT_A_CLOCK_OUT,
  ORG_A,
  ORG_B,
  SITE_A1,
  SITE_A2,
  SITE_B1,
  STAFF_A,
  STAFF_B,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  acknowledgeWarnings,
  approvePreparation,
  attendanceEvidence,
  blockedReadiness,
  createAdjustment,
  createPayrollTenancyDatabase,
  createPeriod,
  hourlyRow,
  persistPreparation,
  recordExport,
  reopenPreparation,
  resetTenantDatabaseRole,
  salariedMalformedRow,
  setTenantAuthUser,
} from "./helpers/payroll-tenancy-db";

describe("guarded commercial payroll lifecycle", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createPayrollTenancyDatabase();
  }, 30_000);

  afterAll(async () => db.close());

  async function authorisedPeriod(periodEnd: string) {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const result = await createPeriod(db, {
      periodStart: "2026-08-03",
      periodEnd,
      operationId: randomUUID(),
    });
    expect(result).toMatchObject({ ok: true, code: "period_created", organisationId: ORG_A, revision: 1 });
    return String(result.periodId);
  }

  it("requires an active payroll.prepare membership and AAL2 before creating a period", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    const aal1 = await createPeriod(db, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-03",
      operationId: randomUUID(),
    });
    expect(aal1).toEqual({ ok: false, code: "mfa_required" });

    await setTenantAuthUser(db, USER_A_SITE_MANAGER, "aal2");
    const noPermission = await createPeriod(db, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-03",
      operationId: randomUUID(),
    });
    expect(noPermission).toEqual({ ok: false, code: "forbidden" });

    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const crossOrganisation = await createPeriod(db, {
      organisationId: ORG_B,
      periodStart: "2026-08-03",
      periodEnd: "2026-08-03",
      operationId: randomUUID(),
    });
    expect(crossOrganisation).toEqual({ ok: false, code: "forbidden" });

    const operationId = randomUUID();
    const first = await createPeriod(db, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-03",
      operationId,
    });
    const retry = await createPeriod(db, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-03",
      operationId,
    });
    expect(first).toMatchObject({ ok: true, code: "period_created", revision: 1 });
    expect(retry).toEqual({ ...first, code: "period_reused", reused: true });

    await expect(db.query(
      `insert into public.payroll_periods (
        organisation_id,period_start,period_end,operation_id,created_by_membership_id
      ) values ($1::uuid,'2026-07-01','2026-07-31',$2::uuid,$3::uuid)`,
      [ORG_A, randomUUID(), "aa000000-0000-0000-0000-000000000001"],
    )).rejects.toThrow(/permission denied/i);
  });

  it("rejects guessed periods, cross-tenant links, invalid sites, forged minutes and malformed fingerprints", async () => {
    const periodId = await authorisedPeriod("2026-08-04");

    const guessed = await persistPreparation(db, {
      periodId: randomUUID(),
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(guessed).toEqual({ ok: false, code: "forbidden" });

    const crossStaff = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow({
        staffId: STAFF_B,
        siteId: SITE_B1,
        payArrangementId: ARRANGEMENT_B_HOURLY,
        sourceKey: "cross-tenant-staff",
        hourlyRate: 15,
      })],
    });
    expect(crossStaff).toEqual({ ok: false, code: "invalid_staff" });

    const crossSite = await persistPreparation(db, {
      periodId,
      siteId: SITE_B1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(crossSite).toEqual({ ok: false, code: "invalid_site" });

    const crossArrangement = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow({ payArrangementId: ARRANGEMENT_B_HOURLY })],
    });
    expect(crossArrangement).toEqual({ ok: false, code: "invalid_pay_arrangement" });

    const forgedMinutes = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow({ rawMinutes: 999, payableMinutes: 999, ordinaryMinutes: 999 })],
    });
    expect(forgedMinutes).toEqual({ ok: false, code: "attendance_evidence_mismatch" });

    const invalidFingerprint = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      inputFingerprint: "browser-supplied-not-a-sha256",
    });
    expect(invalidFingerprint).toEqual({ ok: false, code: "invalid_fingerprint" });
  });

  it("persists blockers as needs_review and never approves their exact revision", async () => {
    const periodId = await authorisedPeriod("2026-08-05");
    const run = await persistPreparation(db, {
      periodId,
      siteId: null,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow(), salariedMalformedRow()],
      readiness: blockedReadiness(),
    });
    expect(run).toMatchObject({
      ok: true,
      code: "preparation_persisted",
      revision: 1,
      status: "needs_review",
      blockerCount: 1,
    });

    const approval = await approvePreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(approval).toEqual({ ok: false, code: "blockers_present" });
  });

  it("requires exact warning acknowledgement, approves, audits export and reopens into history", async () => {
    const periodId = await authorisedPeriod("2026-08-06");
    const run = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(run).toMatchObject({ ok: true, status: "ready", warningCount: 1 });

    const unacknowledged = await approvePreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(unacknowledged).toEqual({ ok: false, code: "warning_acknowledgement_required" });

    const wrongCodes = await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      warningCodes: ["long_shift"],
      note: "Reviewed the warning evidence",
    });
    expect(wrongCodes).toEqual({ ok: false, code: "invalid_warning_acknowledgement" });

    const acknowledgementOperationId = randomUUID();
    const acknowledged = await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 1,
      operationId: acknowledgementOperationId,
      warningCodes: ["unreviewed_day"],
      note: "Reviewed the corrected attendance evidence",
    });
    const acknowledgementRetry = await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 1,
      operationId: acknowledgementOperationId,
      warningCodes: ["unreviewed_day"],
      note: "Reviewed the corrected attendance evidence",
    });
    expect(acknowledged).toMatchObject({ ok: true, code: "warnings_acknowledged", revision: 1 });
    expect(acknowledgementRetry).toEqual({ ...acknowledged, code: "warnings_already_acknowledged", reused: true });

    const overwriteAttempt = await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      warningCodes: ["unreviewed_day"],
      note: "A different operation must not replace the audit record",
    });
    expect(overwriteAttempt).toEqual({ ok: false, code: "warning_acknowledgement_locked" });

    const approvalOperationId = randomUUID();
    const approved = await approvePreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: approvalOperationId,
    });
    const approvalRetry = await approvePreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: approvalOperationId,
    });
    expect(approved).toMatchObject({ ok: true, code: "preparation_approved", revision: 1 });
    expect(approvalRetry).toEqual({ ...approved, code: "approval_reused", reused: true });

    const mismatchedRowFingerprint = await recordExport(db, {
      periodId,
      approvalId: String(approved.approvalId),
      expectedRevision: 1,
      operationId: randomUUID(),
      rowFingerprint: "b".repeat(64),
    });
    expect(mismatchedRowFingerprint).toEqual({ ok: false, code: "export_evidence_mismatch" });

    const mismatchedRowCount = await recordExport(db, {
      periodId,
      approvalId: String(approved.approvalId),
      expectedRevision: 1,
      operationId: randomUUID(),
      rowCount: 99,
    });
    expect(mismatchedRowCount).toEqual({ ok: false, code: "export_evidence_mismatch" });

    const exported = await recordExport(db, {
      periodId,
      approvalId: String(approved.approvalId),
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(exported).toMatchObject({ ok: true, code: "export_recorded", revision: 1 });

    const staleReopen = await reopenPreparation(db, {
      periodId,
      expectedRevision: 99,
      operationId: randomUUID(),
      reason: "Additional manager review required",
    });
    expect(staleReopen).toEqual({ ok: false, code: "stale_revision", currentRevision: 1 });

    const reopenOperationId = randomUUID();
    const reopened = await reopenPreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: reopenOperationId,
      reason: "Additional manager review required",
    });
    const reopenRetry = await reopenPreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: reopenOperationId,
      reason: "Additional manager review required",
    });
    expect(reopened).toMatchObject({ ok: true, code: "preparation_reopened", revision: 2, status: "ready" });
    expect(reopenRetry).toEqual({ ...reopened, code: "reopen_reused", reused: true });

    await resetTenantDatabaseRole(db);
    const history = await db.query<{
      run_count: number;
      approval_count: number;
      export_count: number;
      period_revision: number;
      period_status: string;
    }>(`
      select
        (select count(*)::integer from public.payroll_preparation_runs where period_id=$1::uuid) run_count,
        (select count(*)::integer from public.payroll_approvals where period_id=$1::uuid) approval_count,
        (select count(*)::integer from public.payroll_export_audits where period_id=$1::uuid) export_count,
        period.revision period_revision,
        period.status::text period_status
      from public.payroll_periods period where period.id=$1::uuid
    `, [periodId]);
    expect(history.rows[0]).toEqual({
      run_count: 2,
      approval_count: 2,
      export_count: 1,
      period_revision: 2,
      period_status: "open",
    });
  });

  it("applies each signed adjustment once in a new revision without touching attendance evidence", async () => {
    const periodId = await authorisedPeriod("2026-08-07");
    await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    const attendanceBefore = await attendanceEvidence(db);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");

    const adjustmentOperationId = randomUUID();
    const first = await createAdjustment(db, {
      periodId,
      expectedRevision: 1,
      operationId: adjustmentOperationId,
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 15,
      reason: "Paid handover time confirmed",
    });
    const retry = await createAdjustment(db, {
      periodId,
      expectedRevision: 1,
      operationId: adjustmentOperationId,
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 15,
      reason: "Paid handover time confirmed",
    });
    expect(first).toMatchObject({ ok: true, code: "adjustment_created", revision: 2, adjustmentMinutes: 15 });
    expect(retry).toEqual({ ...first, code: "adjustment_reused", reused: true });

    const conflict = await createAdjustment(db, {
      periodId,
      expectedRevision: 1,
      operationId: adjustmentOperationId,
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 30,
      reason: "Paid handover time confirmed",
    });
    expect(conflict).toEqual({ ok: false, code: "operation_conflict" });

    const stale = await createAdjustment(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 10,
      reason: "Additional paid handover time",
    });
    expect(stale).toEqual({ ok: false, code: "stale_revision", currentRevision: 2 });

    const crossTenantStaff = await createAdjustment(db, {
      periodId,
      expectedRevision: 2,
      operationId: randomUUID(),
      staffId: STAFF_B,
      siteId: SITE_A1,
      adjustmentMinutes: 10,
      reason: "Cross tenant attempt must fail",
    });
    expect(crossTenantStaff).toEqual({ ok: false, code: "invalid_staff" });

    await resetTenantDatabaseRole(db);
    const ledger = await db.query<{
      adjustment_count: number;
      adjustment_minutes: number;
      payable_minutes: number;
      run_count: number;
    }>(`
      select
        (select count(*)::integer from public.payroll_adjustments where period_id=$1::uuid) adjustment_count,
        row.adjustment_minutes,
        row.payable_minutes,
        (select count(*)::integer from public.payroll_preparation_runs where period_id=$1::uuid) run_count
      from public.payroll_preparation_rows row
      join public.payroll_preparation_runs run
        on run.organisation_id=row.organisation_id and run.id=row.run_id
      where run.period_id=$1::uuid and run.revision=2
    `, [periodId]);
    expect(ledger.rows[0]).toEqual({
      adjustment_count: 1,
      adjustment_minutes: 15,
      payable_minutes: 525,
      run_count: 2,
    });
    expect(await attendanceEvidence(db)).toBe(attendanceBefore);
  });

  it("detects pay-arrangement drift without rewriting the stored revision", async () => {
    const periodId = await authorisedPeriod("2026-08-08");
    const run = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      warningCodes: ["unreviewed_day"],
      note: "Reviewed before final approval",
    });

    await resetTenantDatabaseRole(db);
    await db.query(
      "update public.staff_pay_arrangements set hourly_rate=13 where organisation_id=$1::uuid and id=$2::uuid",
      [ORG_A, "41000000-0000-0000-0000-000000000001"],
    );
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const result = await approvePreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, code: "stale_pay_arrangement_fingerprint" });

    await resetTenantDatabaseRole(db);
    const stored = await db.query<{ hourly_rate: string; input_fingerprint: string }>(`
      select row.hourly_rate::text, run.input_fingerprint
      from public.payroll_preparation_rows row
      join public.payroll_preparation_runs run
        on run.organisation_id=row.organisation_id and run.id=row.run_id
      where run.id=$1::uuid
    `, [String(run.runId)]);
    expect(stored.rows).toEqual([{ hourly_rate: "12.50", input_fingerprint: "a".repeat(64) }]);
    await db.query(
      "update public.staff_pay_arrangements set hourly_rate=12.50 where organisation_id=$1::uuid and id=$2::uuid",
      [ORG_A, "41000000-0000-0000-0000-000000000001"],
    );
  });

  it("detects attendance drift without altering historic rows or corrections", async () => {
    const periodId = await authorisedPeriod("2026-08-09");
    const run = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      warningCodes: ["unreviewed_day"],
      note: "Reviewed before final approval",
    });

    await resetTenantDatabaseRole(db);
    await db.query(`
      insert into public.clock_events (
        organisation_id,site_id,staff_id,event_type,event_timestamp,event_source
      ) values ($1::uuid,$2::uuid,$3,'clock_out','2026-08-03T17:00:00+01:00','kiosk')
    `, [ORG_A, SITE_A1, STAFF_A]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const result = await approvePreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, code: "stale_attendance_fingerprint" });

    await resetTenantDatabaseRole(db);
    const history = await db.query<{ row_count: number; correction_count: number; raw_minutes: number }>(`
      select
        (select count(*)::integer from public.payroll_preparation_rows where run_id=$1::uuid) row_count,
        (select count(*)::integer from public.clock_event_corrections where organisation_id=$2::uuid) correction_count,
        (select raw_minutes from public.payroll_preparation_rows where run_id=$1::uuid limit 1) raw_minutes
    `, [String(run.runId), ORG_A]);
    expect(history.rows[0]).toEqual({ row_count: 1, correction_count: 1, raw_minutes: 510 });
  });

  it("keeps public execution narrow and all private command helpers inaccessible", async () => {
    await resetTenantDatabaseRole(db);
    await db.exec("set role anon");
    await expect(db.query(
      "select public.create_commercial_payroll_period($1::uuid,'2026-09-01','2026-09-30',$2::uuid)",
      [ORG_A, randomUUID()],
    )).rejects.toThrow(/permission denied/i);

    await resetTenantDatabaseRole(db);
    const grants = await db.query<{ routine_schema: string; routine_name: string; grantee: string }>(`
      select routine_schema,routine_name,grantee
      from information_schema.routine_privileges
      where (
        routine_schema = 'public' and routine_name like '%commercial_payroll%'
      ) or (
        routine_schema = 'private' and routine_name in (
          'payroll_command_actor',
          'authorised_payroll_period',
          'payroll_attendance_evidence',
          'payroll_attendance_fingerprint',
          'payroll_pay_arrangement_fingerprint',
          'payroll_authoritative_readiness',
          'payroll_canonical_arithmetic',
          'payroll_snapshot_arithmetic',
          'payroll_request_digest',
          'validate_payroll_snapshot',
          'payroll_run_evidence_drift',
          'clone_payroll_run'
        )
      )
      order by routine_schema,routine_name,grantee
    `);
    const publicGrantees = grants.rows
      .filter((row) => row.routine_schema === "public")
      .map((row) => row.grantee);
    expect(publicGrantees).toContain("authenticated");
    expect(publicGrantees).not.toEqual(expect.arrayContaining(["PUBLIC", "anon", "service_role"]));
    expect([...new Set(grants.rows
      .filter((row) => row.routine_schema === "private")
      .map((row) => row.routine_name))].sort()).toEqual([
      "authorised_payroll_period",
      "clone_payroll_run",
      "payroll_attendance_evidence",
      "payroll_attendance_fingerprint",
      "payroll_authoritative_readiness",
      "payroll_canonical_arithmetic",
      "payroll_command_actor",
      "payroll_pay_arrangement_fingerprint",
      "payroll_request_digest",
      "payroll_run_evidence_drift",
      "payroll_snapshot_arithmetic",
      "validate_payroll_snapshot",
    ]);
    expect(grants.rows.some((row) => (
      row.routine_schema === "private"
      && ["PUBLIC", "anon", "authenticated", "service_role"].includes(row.grantee)
    ))).toBe(false);
  });
});

describe("commercial payroll review regressions", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createPayrollTenancyDatabase();
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
  }, 30_000);

  afterEach(async () => db.close());

  async function period(periodStart: string, periodEnd = periodStart) {
    const result = await createPeriod(db, {
      periodStart,
      periodEnd,
      operationId: randomUUID(),
    });
    expect(result).toMatchObject({ ok: true, code: "period_created", revision: 1 });
    return String(result.periodId);
  }

  function canonicalSourceKey(staffId: string, operationalDate: string, siteId: string | null) {
    return `${ORG_A}:${staffId}:${operationalDate}:${siteId ?? "unattributed"}`;
  }

  async function adjustedWeeklyRegime(beforeAdjustment?: () => Promise<void>) {
    await resetTenantDatabaseRole(db);
    await db.query(`
      insert into public.clock_events (
        organisation_id,site_id,staff_id,event_type,event_timestamp,event_source
      ) values
        ($1::uuid,$2::uuid,$3,'clock_in','2026-08-04T08:00:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_out','2026-08-04T23:45:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_in','2026-08-05T08:00:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_out','2026-08-05T23:45:00+01:00','kiosk')
    `, [ORG_A, SITE_A1, STAFF_A]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");

    const periodId = await period("2026-08-03", "2026-08-09");
    const dates = ["2026-08-03", "2026-08-04", "2026-08-05"];
    const preparation = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [
        hourlyRow(),
        hourlyRow({
          operationalDate: "2026-08-04",
          sourceKey: canonicalSourceKey(STAFF_A, "2026-08-04", SITE_A1),
          rawMinutes: 945,
          payableMinutes: 945,
          ordinaryMinutes: 945,
          estimatedGrossValue: 196.88,
        }),
        hourlyRow({
          operationalDate: "2026-08-05",
          sourceKey: canonicalSourceKey(STAFF_A, "2026-08-05", SITE_A1),
          rawMinutes: 945,
          payableMinutes: 945,
          ordinaryMinutes: 945,
          estimatedGrossValue: 196.87,
        }),
      ],
      readiness: {
        issues: [
          ...dates.map((operationalDate) => ({
            code: "unreviewed_day",
            severity: "warning",
            organisationId: ORG_A,
            staffId: STAFF_A,
            siteId: SITE_A1,
            operationalDate,
            sourceId: null,
          })),
          ...["2026-08-04", "2026-08-05"].map((operationalDate) => ({
            code: "long_shift",
            severity: "warning",
            organisationId: ORG_A,
            staffId: STAFF_A,
            siteId: SITE_A1,
            operationalDate,
            sourceId: null,
          })),
          {
            code: "manager_correction",
            severity: "informational",
            organisationId: ORG_A,
            staffId: STAFF_A,
            siteId: SITE_A1,
            operationalDate: "2026-08-03",
            sourceId: CORRECTION_A_CLOCK_OUT,
          },
        ],
        counts: { blocker: 0, warning: 5, informational: 1 },
      },
    });
    expect(preparation).toMatchObject({ ok: true, code: "preparation_persisted", revision: 1 });

    await beforeAdjustment?.();
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const adjustment = await createAdjustment(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 60,
      reason: "Confirmed additional paid opening time",
    });
    expect(adjustment).toMatchObject({ ok: true, code: "adjustment_created", revision: 2 });
    return periodId;
  }

  it("rejects locally valid site pairs when the full staff-day sequence is malformed across sites", async () => {
    await resetTenantDatabaseRole(db);
    await db.query(`
      insert into public.staff_site_assignments (
        organisation_id,staff_id,site_id,effective_from,is_primary,created_by_membership_id
      ) values ($1::uuid,$2,$3::uuid,'2026-08-01',false,'aa000000-0000-0000-0000-000000000001')
    `, [ORG_A, STAFF_A, SITE_A2]);
    await db.query(`
      insert into public.clock_events (
        organisation_id,site_id,staff_id,event_type,event_timestamp,event_source
      ) values
        ($1::uuid,$2::uuid,$3,'clock_in','2026-08-10T08:00:00+01:00','kiosk'),
        ($1::uuid,$4::uuid,$3,'clock_in','2026-08-10T09:00:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_out','2026-08-10T10:00:00+01:00','kiosk'),
        ($1::uuid,$4::uuid,$3,'clock_out','2026-08-10T11:00:00+01:00','kiosk')
    `, [ORG_A, SITE_A1, STAFF_A, SITE_A2]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const periodId = await period("2026-08-10");

    const result = await persistPreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [
        hourlyRow({
          operationalDate: "2026-08-10",
          sourceKey: canonicalSourceKey(STAFF_A, "2026-08-10", SITE_A1),
          rawMinutes: 120,
          payableMinutes: 120,
          ordinaryMinutes: 120,
          estimatedGrossValue: 25,
          warnings: [],
        }),
        hourlyRow({
          siteId: SITE_A2,
          operationalDate: "2026-08-10",
          sourceKey: canonicalSourceKey(STAFF_A, "2026-08-10", SITE_A2),
          rawMinutes: 120,
          payableMinutes: 120,
          ordinaryMinutes: 120,
          estimatedGrossValue: 25,
          warnings: [],
        }),
      ],
      readiness: {
        issues: [SITE_A1, SITE_A2].flatMap((siteId) => ([
          {
            code: "malformed_sequence",
            severity: "blocker",
            organisationId: ORG_A,
            staffId: STAFF_A,
            siteId,
            operationalDate: "2026-08-10",
            sourceId: null,
          },
          {
            code: "unreviewed_day",
            severity: "warning",
            organisationId: ORG_A,
            staffId: STAFF_A,
            siteId,
            operationalDate: "2026-08-10",
            sourceId: null,
          },
        ])),
        counts: { blocker: 2, warning: 2, informational: 0 },
      },
    });

    expect(result).toEqual({ ok: false, code: "attendance_evidence_mismatch" });
  });

  it("rejects a non-canonical payroll row identity", async () => {
    const periodId = await period("2026-08-03");
    const result = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow({ sourceKey: "caller-controlled-row-key" })],
    });

    expect(result).toEqual({ ok: false, code: "invalid_source_key" });
  });

  it("rejects duplicate canonical evidence even when caller row keys differ", async () => {
    const periodId = await period("2026-08-03");
    const result = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow(), hourlyRow({ sourceKey: "a-second-caller-key" })],
    });

    expect(result).toEqual({ ok: false, code: "duplicate_evidence" });
  });

  it("rejects caller-forged estimated gross arithmetic", async () => {
    const periodId = await period("2026-08-03");
    const result = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow({ estimatedGrossValue: 999 })],
    });

    expect(result).toEqual({ ok: false, code: "invalid_arithmetic" });
  });

  it("rejects readiness that omits an authoritative attendance blocker", async () => {
    await resetTenantDatabaseRole(db);
    await db.query(`
      insert into public.attendance_exceptions (
        organisation_id,site_id,staff_id,operational_date,exception_type,status,
        anomaly_fingerprint,detection_revision,source
      ) values ($1::uuid,$2::uuid,$3,'2026-08-03','missing_clock_out','open',$4,'events:fixture','automatic')
    `, [ORG_A, SITE_A1, STAFF_A, randomUUID()]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const periodId = await period("2026-08-03", "2026-08-04");
    const result = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });

    expect(result).toEqual({ ok: false, code: "invalid_readiness" });
  });

  it("detects same-minute attendance correction identity drift at approval", async () => {
    const periodId = await period("2026-08-03", "2026-08-04");
    await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      warningCodes: ["unreviewed_day"],
      note: "Reviewed the corrected evidence",
    });
    await resetTenantDatabaseRole(db);
    await db.query(`
      insert into public.clock_event_corrections (
        batch_id,correction_role,organisation_id,site_id,staff_id,correction_kind,
        original_event_id,supersedes_correction_id,event_type,event_timestamp,recorded_date,
        reason,created_by,created_by_membership_id
      ) values (
        $1::uuid,'manager',$2::uuid,$3::uuid,$4,'replace',$5::uuid,$6::uuid,
        'clock_out','2026-08-03T16:30:00+01:00','2026-08-03',
        'Reconfirmed without changing the time','99000000-0000-0000-0000-000000000001',
        'aa000000-0000-0000-0000-000000000001'
      )
    `, [randomUUID(), ORG_A, SITE_A1, STAFF_A, EVENT_A_CLOCK_OUT, CORRECTION_A_CLOCK_OUT]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");

    const result = await approvePreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, code: "stale_attendance_fingerprint" });
  });

  it("detects same-value pay-arrangement metadata drift at approval", async () => {
    const periodId = await period("2026-08-03", "2026-08-04");
    await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      warningCodes: ["unreviewed_day"],
      note: "Reviewed the corrected evidence",
    });
    await resetTenantDatabaseRole(db);
    await db.query(
      "update public.staff_pay_arrangements set manager_notes='Approved metadata changed' where organisation_id=$1::uuid and id=$2::uuid",
      [ORG_A, ARRANGEMENT_A_HOURLY],
    );
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");

    const result = await approvePreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, code: "stale_pay_arrangement_fingerprint" });
  });

  it("does not let re-preparation erase an active adjustment", async () => {
    const periodId = await period("2026-08-03", "2026-08-04");
    await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    await createAdjustment(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    });

    const result = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 2,
      operationId: randomUUID(),
    });
    expect(result).toMatchObject({ ok: true, code: "preparation_persisted", revision: 3 });

    await resetTenantDatabaseRole(db);
    const current = await db.query<{ revision: number; adjustment_minutes: number }>(`
      select run.revision,row_value.adjustment_minutes
      from public.payroll_periods period
      join public.payroll_preparation_runs run
        on run.organisation_id=period.organisation_id
       and run.period_id=period.id and run.revision=period.revision
      join public.payroll_preparation_rows row_value
        on row_value.organisation_id=run.organisation_id and row_value.run_id=run.id
      where period.id=$1::uuid
    `, [periodId]);
    expect(current.rows).toEqual([{ revision: 3, adjustment_minutes: 15 }]);
  });

  it("returns a typed error when a negative adjustment exceeds its canonical source row", async () => {
    await resetTenantDatabaseRole(db);
    await db.query(`
      insert into public.clock_events (
        organisation_id,site_id,staff_id,event_type,event_timestamp,event_source
      ) values
        ($1::uuid,$2::uuid,$3,'clock_in','2026-08-11T08:00:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_out','2026-08-11T09:00:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_in','2026-08-12T08:00:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_out','2026-08-12T09:00:00+01:00','kiosk')
    `, [ORG_A, SITE_A1, STAFF_A]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const periodId = await period("2026-08-11", "2026-08-12");
    const readiness = {
      issues: ["2026-08-11", "2026-08-12"].map((operationalDate) => ({
        code: "unreviewed_day",
        severity: "warning",
        organisationId: ORG_A,
        staffId: STAFF_A,
        siteId: SITE_A1,
        operationalDate,
        sourceId: null,
      })),
      counts: { blocker: 0, warning: 2, informational: 0 },
    };
    const rows = ["2026-08-11", "2026-08-12"].map((operationalDate) => hourlyRow({
      operationalDate,
      sourceKey: canonicalSourceKey(STAFF_A, operationalDate, SITE_A1),
      rawMinutes: 60,
      payableMinutes: 60,
      ordinaryMinutes: 60,
      estimatedGrossValue: 12.5,
      warnings: [],
    }));
    await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows,
      readiness,
    });

    const result = await createAdjustment(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: -90,
      reason: "Remove time from one canonical row",
    });
    expect(result).toEqual({ ok: false, code: "adjustment_exceeds_source" });
  });

  it("treats changed expected revisions as operation conflicts on reused preparation and adjustment commands", async () => {
    const periodId = await period("2026-08-03", "2026-08-04");
    const preparationOperationId = randomUUID();
    await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: preparationOperationId,
    });
    const preparationReuse = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 99,
      operationId: preparationOperationId,
    });

    const adjustmentOperationId = randomUUID();
    await createAdjustment(db, {
      periodId,
      expectedRevision: 1,
      operationId: adjustmentOperationId,
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    });
    const adjustmentReuse = await createAdjustment(db, {
      periodId,
      expectedRevision: 99,
      operationId: adjustmentOperationId,
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    });

    expect([preparationReuse, adjustmentReuse]).toEqual([
      { ok: false, code: "operation_conflict" },
      { ok: false, code: "operation_conflict" },
    ]);
  });

  it("treats changed expected revisions as conflicts on reused acknowledgement, approval, export and reopen commands", async () => {
    const periodId = await period("2026-08-03", "2026-08-04");
    await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    const acknowledgementOperationId = randomUUID();
    await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 1,
      operationId: acknowledgementOperationId,
      warningCodes: ["unreviewed_day"],
      note: "Reviewed the corrected evidence",
    });
    const acknowledgementReuse = await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 99,
      operationId: acknowledgementOperationId,
      warningCodes: ["unreviewed_day"],
      note: "Reviewed the corrected evidence",
    });

    const approvalOperationId = randomUUID();
    const approved = await approvePreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: approvalOperationId,
    });
    const approvalReuse = await approvePreparation(db, {
      periodId,
      expectedRevision: 99,
      operationId: approvalOperationId,
    });
    const exportOperationId = randomUUID();
    await recordExport(db, {
      periodId,
      approvalId: String(approved.approvalId),
      expectedRevision: 1,
      operationId: exportOperationId,
    });
    const exportReuse = await recordExport(db, {
      periodId,
      approvalId: String(approved.approvalId),
      expectedRevision: 99,
      operationId: exportOperationId,
      evidenceRevision: 1,
    });
    const reopenOperationId = randomUUID();
    await reopenPreparation(db, {
      periodId,
      expectedRevision: 1,
      operationId: reopenOperationId,
      reason: "Additional manager review required",
    });
    const reopenReuse = await reopenPreparation(db, {
      periodId,
      expectedRevision: 99,
      operationId: reopenOperationId,
      reason: "Additional manager review required",
    });

    expect([acknowledgementReuse, approvalReuse, exportReuse, reopenReuse]).toEqual([
      { ok: false, code: "operation_conflict" },
      { ok: false, code: "operation_conflict" },
      { ok: false, code: "operation_conflict" },
      { ok: false, code: "operation_conflict" },
    ]);
  });

  it("rejects a caller-forged ordinary and overtime split even when its gross matches that split", async () => {
    const periodId = await period("2026-08-03", "2026-08-04");
    const result = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [hourlyRow({
        ordinaryMinutes: 0,
        overtimeMinutes: 510,
        estimatedGrossValue: 159.38,
      })],
    });

    expect(result).toEqual({ ok: false, code: "invalid_arithmetic" });
  });

  it("accepts Task 2 group rounding when the final row carries the penny residual", async () => {
    await resetTenantDatabaseRole(db);
    await db.query(`
      insert into public.clock_events (
        organisation_id,site_id,staff_id,event_type,event_timestamp,event_source
      ) values
        ($1::uuid,$2::uuid,$3,'clock_in','2026-08-11T08:00:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_out','2026-08-11T08:01:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_in','2026-08-12T08:00:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_out','2026-08-12T08:01:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_in','2026-08-13T08:00:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_out','2026-08-13T08:01:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_in','2026-08-14T08:00:00+01:00','kiosk'),
        ($1::uuid,$2::uuid,$3,'clock_out','2026-08-14T08:01:00+01:00','kiosk')
    `, [ORG_A, SITE_A1, STAFF_A]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const periodId = await period("2026-08-11", "2026-08-14");
    const dates = ["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"];
    const result = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: dates.map((operationalDate, index) => hourlyRow({
        operationalDate,
        sourceKey: canonicalSourceKey(STAFF_A, operationalDate, SITE_A1),
        rawMinutes: 1,
        payableMinutes: 1,
        ordinaryMinutes: 1,
        overtimeMinutes: 0,
        estimatedGrossValue: index === 3 ? 0.2 : 0.21,
        warnings: [],
      })),
      readiness: {
        issues: dates.map((operationalDate) => ({
          code: "unreviewed_day",
          severity: "warning",
          organisationId: ORG_A,
          staffId: STAFF_A,
          siteId: SITE_A1,
          operationalDate,
          sourceId: null,
        })),
        counts: { blocker: 0, warning: 4, informational: 0 },
      },
    });

    expect(result).toMatchObject({ ok: true, code: "preparation_persisted", revision: 1 });
  });

  it("does not let re-preparation erase an adjustment after approval and reopen", async () => {
    const periodId = await period("2026-08-03", "2026-08-04");
    await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    await createAdjustment(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    });
    await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 2,
      operationId: randomUUID(),
      warningCodes: ["unreviewed_day"],
      note: "Reviewed before approval and reopen",
    });
    await approvePreparation(db, {
      periodId,
      expectedRevision: 2,
      operationId: randomUUID(),
    });
    await reopenPreparation(db, {
      periodId,
      expectedRevision: 2,
      operationId: randomUUID(),
      reason: "Additional manager review required",
    });

    const result = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 3,
      operationId: randomUUID(),
    });
    expect(result).toMatchObject({ ok: true, code: "preparation_persisted", revision: 4 });

    await resetTenantDatabaseRole(db);
    const current = await db.query<{ revision: number; adjustment_minutes: number }>(`
      select run.revision,row_value.adjustment_minutes
      from public.payroll_periods period
      join public.payroll_preparation_runs run
        on run.organisation_id=period.organisation_id
       and run.period_id=period.id and run.revision=period.revision
      join public.payroll_preparation_rows row_value
        on row_value.organisation_id=run.organisation_id and row_value.run_id=run.id
      where period.id=$1::uuid
    `, [periodId]);
    expect(current.rows).toEqual([{ revision: 4, adjustment_minutes: 15 }]);
  });

  it("returns a typed error before a repeated adjustment exceeds the cumulative row bound", async () => {
    const periodId = await period("2026-08-03", "2026-08-04");
    await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: randomUUID(),
    });
    const first = await createAdjustment(db, {
      periodId,
      expectedRevision: 1,
      operationId: randomUUID(),
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 9_570,
      reason: "Maximum bounded payable target",
    });
    expect(first).toMatchObject({ ok: true, code: "adjustment_created", revision: 2 });

    const result = await createAdjustment(db, {
      periodId,
      expectedRevision: 2,
      operationId: randomUUID(),
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 1,
      reason: "Must not exceed the cumulative bound",
    });
    expect(result).toEqual({ ok: false, code: "adjustment_out_of_range" });
  });

  it("reallocates ordinary and overtime minutes across the whole regime before approval", async () => {
    const periodId = await adjustedWeeklyRegime();
    await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 2,
      operationId: randomUUID(),
      warningCodes: ["long_shift", "unreviewed_day"],
      note: "Reviewed the full adjusted weekly regime",
    });
    const approval = await approvePreparation(db, {
      periodId,
      expectedRevision: 2,
      operationId: randomUUID(),
    });
    expect(approval).toMatchObject({ ok: true, code: "preparation_approved", revision: 2 });

    await resetTenantDatabaseRole(db);
    const rows = await db.query<{
      operational_date: string;
      adjustment_minutes: number;
      payable_minutes: number;
      ordinary_minutes: number;
      overtime_minutes: number;
    }>(`
      select operational_date::text,adjustment_minutes,payable_minutes,
        ordinary_minutes,overtime_minutes
      from public.payroll_preparation_rows
      where organisation_id=$1::uuid and run_id=$2::uuid
      order by operational_date,source_key
    `, [ORG_A, String(approval.runId)]);
    expect(rows.rows).toEqual([
      {
        operational_date: "2026-08-03",
        adjustment_minutes: 60,
        payable_minutes: 570,
        ordinary_minutes: 570,
        overtime_minutes: 0,
      },
      {
        operational_date: "2026-08-04",
        adjustment_minutes: 0,
        payable_minutes: 945,
        ordinary_minutes: 945,
        overtime_minutes: 0,
      },
      {
        operational_date: "2026-08-05",
        adjustment_minutes: 0,
        payable_minutes: 945,
        ordinary_minutes: 885,
        overtime_minutes: 60,
      },
    ]);
  });

  it("reallocates arrangement gross and the final-row penny residual after adjustment", async () => {
    const periodId = await adjustedWeeklyRegime();

    await resetTenantDatabaseRole(db);
    const rows = await db.query<{ operational_date: string; estimated_gross_value: string }>(`
      select row_value.operational_date::text,row_value.estimated_gross_value::text
      from public.payroll_periods period
      join public.payroll_preparation_runs run
        on run.organisation_id=period.organisation_id
       and run.period_id=period.id and run.revision=period.revision
      join public.payroll_preparation_rows row_value
        on row_value.organisation_id=run.organisation_id and row_value.run_id=run.id
      where period.organisation_id=$1::uuid and period.id=$2::uuid
      order by row_value.operational_date,row_value.source_key
    `, [ORG_A, periodId]);
    expect(rows.rows).toEqual([
      { operational_date: "2026-08-03", estimated_gross_value: "118.75" },
      { operational_date: "2026-08-04", estimated_gross_value: "196.88" },
      { operational_date: "2026-08-05", estimated_gross_value: "203.12" },
    ]);
  });

  it("keeps the adjustment target stable while a new preparation uses the current pay arrangement", async () => {
    const periodId = await adjustedWeeklyRegime(async () => {
      await resetTenantDatabaseRole(db);
      await db.query(`
        update public.staff_pay_arrangements
        set hourly_rate=20, overtime_multiplier=2,
          contracted_weekly_hours=80, hours_basis='variable_hours'
        where organisation_id=$1::uuid and id=$2::uuid
      `, [ORG_A, ARRANGEMENT_A_HOURLY]);
    });

    await resetTenantDatabaseRole(db);
    const rows = await db.query<{
      operational_date: string;
      pay_type: string;
      hourly_rate: string;
      overtime_multiplier: string;
      ordinary_minutes: number;
      overtime_minutes: number;
      estimated_gross_value: string;
    }>(`
      select row_value.operational_date::text,row_value.pay_type::text,
        row_value.hourly_rate::text,row_value.overtime_multiplier::text,
        row_value.ordinary_minutes,row_value.overtime_minutes,
        row_value.estimated_gross_value::text
      from public.payroll_periods period
      join public.payroll_preparation_runs run
        on run.organisation_id=period.organisation_id
       and run.period_id=period.id and run.revision=period.revision
      join public.payroll_preparation_rows row_value
        on row_value.organisation_id=run.organisation_id and row_value.run_id=run.id
      where period.organisation_id=$1::uuid and period.id=$2::uuid
      order by row_value.operational_date,row_value.source_key
    `, [ORG_A, periodId]);
    expect(rows.rows).toEqual([
      {
        operational_date: "2026-08-03",
        pay_type: "hourly",
        hourly_rate: "20.00",
        overtime_multiplier: "2.00",
        ordinary_minutes: 570,
        overtime_minutes: 0,
        estimated_gross_value: "190.00",
      },
      {
        operational_date: "2026-08-04",
        pay_type: "hourly",
        hourly_rate: "20.00",
        overtime_multiplier: "2.00",
        ordinary_minutes: 945,
        overtime_minutes: 0,
        estimated_gross_value: "315.00",
      },
      {
        operational_date: "2026-08-05",
        pay_type: "hourly",
        hourly_rate: "20.00",
        overtime_multiplier: "2.00",
        ordinary_minutes: 945,
        overtime_minutes: 0,
        estimated_gross_value: "315.00",
      },
    ]);

    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 2,
      operationId: randomUUID(),
      warningCodes: ["long_shift", "unreviewed_day"],
      note: "Reviewed the historic adjusted pay snapshot",
    });
    const approval = await approvePreparation(db, {
      periodId,
      expectedRevision: 2,
      operationId: randomUUID(),
    });
    expect(approval).toMatchObject({ ok: true, code: "preparation_approved", revision: 2 });
  });

  it("binds preparation idempotency to the canonical site, rows and readiness payload", async () => {
    const periodId = await period("2026-08-03", "2026-08-04");
    const operationId = randomUUID();
    await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId,
    });

    const changedSite = await persistPreparation(db, {
      periodId,
      siteId: null,
      expectedRevision: 1,
      operationId,
    });
    const changedRows = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId,
      rows: [hourlyRow({ estimatedGrossValue: 999 })],
    });
    const changedReadiness = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId,
      readiness: { issues: [], counts: { blocker: 0, warning: 0, informational: 0 } },
    });

    expect([changedSite, changedRows, changedReadiness]).toEqual([
      { ok: false, code: "operation_conflict" },
      { ok: false, code: "operation_conflict" },
      { ok: false, code: "operation_conflict" },
    ]);
  });

  it("treats a null expected revision as a conflict for every reused revision command", async () => {
    const periodId = await period("2026-08-03", "2026-08-04");
    const preparationOperationId = randomUUID();
    await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: 1,
      operationId: preparationOperationId,
    });
    const preparationReuse = await persistPreparation(db, {
      periodId,
      siteId: SITE_A1,
      expectedRevision: null,
      operationId: preparationOperationId,
    });

    const adjustmentOperationId = randomUUID();
    await createAdjustment(db, {
      periodId,
      expectedRevision: 1,
      operationId: adjustmentOperationId,
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    });
    const adjustmentReuse = await createAdjustment(db, {
      periodId,
      expectedRevision: null,
      operationId: adjustmentOperationId,
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 15,
      reason: "Confirmed paid handover time",
    });

    const acknowledgementOperationId = randomUUID();
    await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: 2,
      operationId: acknowledgementOperationId,
      warningCodes: ["unreviewed_day"],
      note: "Reviewed before final approval",
    });
    const acknowledgementReuse = await acknowledgeWarnings(db, {
      periodId,
      expectedRevision: null,
      operationId: acknowledgementOperationId,
      warningCodes: ["unreviewed_day"],
      note: "Reviewed before final approval",
    });

    const approvalOperationId = randomUUID();
    const approved = await approvePreparation(db, {
      periodId,
      expectedRevision: 2,
      operationId: approvalOperationId,
    });
    const approvalReuse = await approvePreparation(db, {
      periodId,
      expectedRevision: null,
      operationId: approvalOperationId,
    });

    const exportOperationId = randomUUID();
    await recordExport(db, {
      periodId,
      approvalId: String(approved.approvalId),
      expectedRevision: 2,
      operationId: exportOperationId,
    });
    const exportReuse = await recordExport(db, {
      periodId,
      approvalId: String(approved.approvalId),
      expectedRevision: null,
      operationId: exportOperationId,
      evidenceRevision: 2,
    });

    const reopenOperationId = randomUUID();
    await reopenPreparation(db, {
      periodId,
      expectedRevision: 2,
      operationId: reopenOperationId,
      reason: "Additional manager review required",
    });
    const reopenReuse = await reopenPreparation(db, {
      periodId,
      expectedRevision: null,
      operationId: reopenOperationId,
      reason: "Additional manager review required",
    });

    expect([
      preparationReuse,
      adjustmentReuse,
      acknowledgementReuse,
      approvalReuse,
      exportReuse,
      reopenReuse,
    ]).toEqual(Array.from({ length: 6 }, () => ({ ok: false, code: "operation_conflict" })));
  });

  it.each(["unresolved_exception", "pending_request"] as const)(
    "recomputes canonical readiness at approval after a new %s blocker",
    async (blockerKind) => {
      const periodId = await period("2026-08-03", "2026-08-04");
      await persistPreparation(db, {
        periodId,
        siteId: SITE_A1,
        expectedRevision: 1,
        operationId: randomUUID(),
      });
      await acknowledgeWarnings(db, {
        periodId,
        expectedRevision: 1,
        operationId: randomUUID(),
        warningCodes: ["unreviewed_day"],
        note: "Reviewed before final approval",
      });
      await resetTenantDatabaseRole(db);
      if (blockerKind === "unresolved_exception") {
        await db.query(`
          insert into public.attendance_exceptions (
            organisation_id,site_id,staff_id,operational_date,exception_type,status,
            anomaly_fingerprint,detection_revision,source
          ) values ($1::uuid,$2::uuid,$3,'2026-08-03','missing_clock_out','open',$4,'events:late','automatic')
        `, [ORG_A, SITE_A1, STAFF_A, randomUUID()]);
      } else {
        await db.query(`
          insert into public.attendance_correction_requests (
            organisation_id,site_id,staff_id,attendance_date,issue_type,staff_note,status,
            created_by_membership_id
          ) values (
            $1::uuid,$2::uuid,$3,'2026-08-03','missing_clock_out',
            'Late request before payroll approval','pending',
            'aa000000-0000-0000-0000-000000000001'
          )
        `, [ORG_A, SITE_A1, STAFF_A]);
      }
      await setTenantAuthUser(db, USER_A_OWNER, "aal2");

      const result = await approvePreparation(db, {
        periodId,
        expectedRevision: 1,
        operationId: randomUUID(),
      });
      expect(result).toEqual({ ok: false, code: "stale_readiness" });
    },
  );
});
