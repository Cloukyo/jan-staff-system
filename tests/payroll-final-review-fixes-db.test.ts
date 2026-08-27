// @vitest-environment node

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  ARRANGEMENT_A_HOURLY,
  ARRANGEMENT_A2_SALARY,
  ORG_A,
  SITE_A1,
  STAFF_A,
  STAFF_A2,
  USER_A_OWNER,
  createAdjustment,
  createPayrollTenancyDatabase,
  createPeriod,
  hourlyRow,
  persistPreparation,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/payroll-tenancy-db";

type CommandResult = { ok: boolean; code: string; [key: string]: unknown };

describe("payroll final-review database fixes", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createPayrollTenancyDatabase();
  }, 30_000);

  afterAll(async () => db.close());

  it("blocks direct AAL1 commercial pay edits and creates a new effective-dated value through an audited AAL2 command", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    await db.exec("begin");
    const direct = await db.query<{ hourly_rate: string }>(`
      update public.staff_pay_arrangements
      set hourly_rate = 99
      where organisation_id=$1::uuid and id=$2::uuid
      returning hourly_rate::text
    `, [ORG_A, ARRANGEMENT_A_HOURLY]);
    await db.exec("rollback");
    expect(direct.rows).toEqual([]);

    const parameters = [
      ORG_A,
      randomUUID(),
      STAFF_A,
      SITE_A1,
      ARRANGEMENT_A_HOURLY,
      "hourly",
      13.75,
      null,
      null,
      40,
      "contracted",
      8,
      1.5,
      "2026-08-10",
      "Rate agreed for the new effective period",
    ];
    const aal1 = await db.query<{ value: CommandResult }>(`
      select public.create_commercial_staff_pay_arrangement(
        $1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6::public.payroll_pay_type,
        $7::numeric,$8::numeric,$9::numeric,$10::numeric,$11,$12::numeric,
        $13::numeric,$14::date,$15
      ) value
    `, parameters);
    expect(aal1.rows[0].value).toEqual({ ok: false, code: "mfa_required" });

    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const created = await db.query<{ value: CommandResult }>(`
      select public.create_commercial_staff_pay_arrangement(
        $1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6::public.payroll_pay_type,
        $7::numeric,$8::numeric,$9::numeric,$10::numeric,$11,$12::numeric,
        $13::numeric,$14::date,$15
      ) value
    `, parameters.map((value, index) => index === 1 ? randomUUID() : value));
    expect(created.rows[0].value).toMatchObject({
      ok: true,
      code: "pay_arrangement_created",
      organisationId: ORG_A,
    });

    await resetTenantDatabaseRole(db);
    const history = await db.query<{
      old_rate: string;
      old_end: string;
      new_rate: string;
      new_start: string;
      audit_count: number;
    }>(`
      select old.hourly_rate::text old_rate, old.effective_to::text old_end,
        replacement.hourly_rate::text new_rate, replacement.effective_from::text new_start,
        (select count(*)::integer from public.payroll_pay_arrangement_change_audits audit
          where audit.organisation_id=$1::uuid and audit.previous_arrangement_id=old.id) audit_count
      from public.staff_pay_arrangements old
      join public.staff_pay_arrangements replacement
        on replacement.organisation_id=old.organisation_id
       and replacement.staff_id=old.staff_id and replacement.effective_from='2026-08-10'
      where old.organisation_id=$1::uuid and old.id=$2::uuid
    `, [ORG_A, ARRANGEMENT_A_HOURLY]);
    expect(history.rows).toEqual([{
      old_rate: "12.50",
      old_end: "2026-08-09",
      new_rate: "13.75",
      new_start: "2026-08-10",
      audit_count: 1,
    }]);
  });

  it("persists eligible zero-attendance staff summaries without inventing site or payable minutes", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const period = await createPeriod(db, {
      periodStart: "2026-08-17",
      periodEnd: "2026-08-23",
      operationId: randomUUID(),
    });
    await resetTenantDatabaseRole(db);
    const activeHourly = await db.query<{ id: string; hourly_rate: string }>(`
      select id::text, hourly_rate::text from public.staff_pay_arrangements
      where organisation_id=$1::uuid and staff_id=$2
        and effective_from <= '2026-08-17' and coalesce(effective_to, 'infinity'::date) >= '2026-08-17'
      order by effective_from desc limit 1
    `, [ORG_A, STAFF_A]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const activeHourlyId = activeHourly.rows[0].id;
    const result = await persistPreparation(db, {
      periodId: String(period.periodId),
      expectedRevision: 1,
      operationId: randomUUID(),
      rows: [
        {
          ...hourlyRow({
            siteId: null,
            payArrangementId: activeHourlyId,
            operationalDate: "2026-08-17",
            sourceKey: `staff-summary:${ORG_A}:${STAFF_A}:${activeHourlyId}`,
            hourlyRate: Number(activeHourly.rows[0].hourly_rate),
            rawMinutes: 0,
            payableMinutes: 0,
            ordinaryMinutes: 0,
            estimatedGrossValue: 0,
          }),
          sourceKind: "staff_summary",
        },
        {
          ...hourlyRow({
            staffId: STAFF_A2,
            siteId: null,
            payArrangementId: ARRANGEMENT_A2_SALARY,
            operationalDate: "2026-08-17",
            sourceKey: `staff-summary:${ORG_A}:${STAFF_A2}:${ARRANGEMENT_A2_SALARY}`,
            payType: "salaried",
            rawMinutes: 0,
            payableMinutes: 0,
            ordinaryMinutes: 0,
            hourlyRate: null,
            annualSalary: 24_000,
            monthlySalary: 2_000,
            overtimeMultiplier: 1,
            estimatedGrossValue: null,
          }),
          sourceKind: "staff_summary",
        },
      ],
      readiness: { issues: [], counts: { blocker: 0, warning: 0, informational: 0 } },
    });
    expect(result).toMatchObject({ ok: true, code: "preparation_persisted", status: "ready" });

    await resetTenantDatabaseRole(db);
    const stored = await db.query<{
      staff_id: string;
      site_id: string | null;
      raw_minutes: number;
      payable_minutes: number;
      pay_type: string;
    }>(`
      select staff_id,site_id::text,raw_minutes,payable_minutes,pay_type::text
      from public.payroll_preparation_rows where run_id=$1::uuid order by staff_id
    `, [String(result.runId)]);
    expect(stored.rows).toEqual([
      { staff_id: STAFF_A, site_id: null, raw_minutes: 0, payable_minutes: 0, pay_type: "hourly" },
      { staff_id: STAFF_A2, site_id: null, raw_minutes: 0, payable_minutes: 0, pay_type: "salaried" },
    ]);
  });

  it("keeps one active lineage across recalculation without carry replay", async () => {
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
    expect(initial).toMatchObject({ ok: true, code: "preparation_persisted", revision: 1 });
    const adjustment = await createAdjustment(db, {
      periodId: String(period.periodId),
      expectedRevision: Number(initial.revision),
      operationId: randomUUID(),
      staffId: STAFF_A,
      siteId: SITE_A1,
      adjustmentMinutes: 15,
      reason: "Additional handover time confirmed",
    });
    expect(adjustment).toMatchObject({ ok: true, code: "adjustment_created", revision: 2 });

    await resetTenantDatabaseRole(db);
    await db.query(`
      update public.clock_event_corrections
      set event_timestamp='2026-08-03T17:00:00+01:00'
      where organisation_id=$1::uuid and original_event_id is not null
    `, [ORG_A]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const recalculated = await persistPreparation(db, {
      periodId: String(period.periodId),
      siteId: SITE_A1,
      expectedRevision: Number(adjustment.revision),
      operationId: randomUUID(),
      rows: [hourlyRow({
        rawMinutes: 540,
        payableMinutes: 540,
        ordinaryMinutes: 540,
        estimatedGrossValue: 112.5,
      })],
    });
    expect(recalculated).toMatchObject({ ok: true, code: "preparation_persisted", revision: 3 });

    await resetTenantDatabaseRole(db);
    const lifecycle = await db.query<{
      active_count: number;
      carried_count: number;
      snapshot_count: number;
      payable_minutes: number;
      adjustment_minutes: number;
    }>(`
      select
        count(*) filter (where adjustment.status='active')::integer active_count,
        count(*) filter (where adjustment.carried_from_adjustment_id is not null)::integer carried_count,
        (select count(*)::integer from public.payroll_run_adjustment_snapshots snapshot
          join public.payroll_periods current_period
            on current_period.organisation_id=snapshot.organisation_id
           and current_period.id=snapshot.period_id
          join public.payroll_preparation_runs current_run
            on current_run.organisation_id=current_period.organisation_id
           and current_run.period_id=current_period.id
           and current_run.revision=current_period.revision
           and current_run.id=snapshot.run_id) snapshot_count,
        (select row_value.payable_minutes from public.payroll_periods current_period
          join public.payroll_preparation_runs current_run
            on current_run.organisation_id=current_period.organisation_id
           and current_run.period_id=current_period.id
           and current_run.revision=current_period.revision
          join public.payroll_preparation_rows row_value
            on row_value.organisation_id=current_run.organisation_id
           and row_value.run_id=current_run.id
          where current_period.id=$2::uuid limit 1)::integer payable_minutes,
        (select row_value.adjustment_minutes from public.payroll_periods current_period
          join public.payroll_preparation_runs current_run
            on current_run.organisation_id=current_period.organisation_id
           and current_run.period_id=current_period.id
           and current_run.revision=current_period.revision
          join public.payroll_preparation_rows row_value
            on row_value.organisation_id=current_run.organisation_id
           and row_value.run_id=current_run.id
          where current_period.id=$2::uuid limit 1)::integer adjustment_minutes
      from public.payroll_adjustments adjustment
      where adjustment.organisation_id=$1::uuid and adjustment.period_id=$2::uuid
    `, [ORG_A, period.periodId]);
    expect(lifecycle.rows).toEqual([{
      active_count: 1,
      carried_count: 0,
      snapshot_count: 1,
      payable_minutes: 555,
      adjustment_minutes: 15,
    }]);
  });
});
