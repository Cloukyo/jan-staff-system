import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import {
  MEMBERSHIP_A_OWNER,
  ORG_A,
  ORG_B,
  SITE_A1,
  SITE_A2,
  SITE_B1,
  STAFF_A,
  STAFF_A2,
  STAFF_B,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  createAttendanceTenancyDatabase,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./attendance-tenancy-db";

export {
  ORG_A,
  ORG_B,
  SITE_A1,
  SITE_A2,
  SITE_B1,
  STAFF_A,
  STAFF_A2,
  STAFF_B,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
};

export const ARRANGEMENT_A_HOURLY = "41000000-0000-0000-0000-000000000001";
export const ARRANGEMENT_A2_SALARY = "41000000-0000-0000-0000-000000000002";
export const ARRANGEMENT_B_HOURLY = "42000000-0000-0000-0000-000000000001";
export const EVENT_A_CLOCK_IN = "51000000-0000-0000-0000-000000000001";
export const EVENT_A_CLOCK_OUT = "51000000-0000-0000-0000-000000000002";
export const CORRECTION_A_CLOCK_OUT = "52000000-0000-0000-0000-000000000001";
export const EVENT_A2_MALFORMED_CLOCK_OUT = "51000000-0000-0000-0000-000000000003";
export const EVENT_B_CLOCK_IN = "61000000-0000-0000-0000-000000000001";
export const EVENT_B_CLOCK_OUT = "61000000-0000-0000-0000-000000000002";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

const inheritedPayrollSql = `
create type public.payroll_pay_type as enum ('hourly', 'salaried');
create type public.payroll_import_batch_status as enum ('draft', 'ready', 'imported', 'cancelled');

alter table public.staff_pay_arrangements
  add column pay_type public.payroll_pay_type,
  add column hourly_rate numeric(10,2),
  add column annual_salary numeric(12,2),
  add column monthly_salary numeric(12,2),
  add column contracted_weekly_hours numeric(5,2) not null default 0,
  add column hours_basis text not null default 'contracted',
  add column standard_daily_hours numeric(5,2),
  add column overtime_multiplier numeric(5,2) not null default 1,
  add column effective_to date,
  add column is_active boolean not null default true,
  add column manager_notes text,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

create table public.payroll_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_filename text not null,
  status public.payroll_import_batch_status not null default 'draft',
  created_by uuid not null references public.staff_accounts(id),
  created_at timestamptz not null default now()
);

create table public.payroll_import_review_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payroll_import_batches(id),
  source_row_index integer not null,
  suggested_staff_id text references public.staff_profiles(id),
  selected_staff_id text references public.staff_profiles(id),
  created_by uuid not null references public.staff_accounts(id),
  updated_by uuid not null references public.staff_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, source_row_index)
);

alter table public.payroll_import_batches enable row level security;
alter table public.payroll_import_review_rows enable row level security;
create policy "Managers can manage payroll import batches" on public.payroll_import_batches
  for all to authenticated using (public.current_staff_role() = 'manager')
  with check (public.current_staff_role() = 'manager');
create policy "Managers can manage payroll import review rows" on public.payroll_import_review_rows
  for all to authenticated using (public.current_staff_role() = 'manager')
  with check (public.current_staff_role() = 'manager');
grant select, insert, update, delete on public.payroll_import_batches, public.payroll_import_review_rows to authenticated;
`;

const payrollFixtureSql = `
insert into public.staff_pay_arrangements (
  id, staff_id, pay_type, hourly_rate, annual_salary, monthly_salary,
  contracted_weekly_hours, standard_daily_hours, overtime_multiplier,
  effective_from, effective_to, is_active, created_by, updated_by
) values
  ('${ARRANGEMENT_A_HOURLY}', '${STAFF_A}', 'hourly', 12.50, null, null, 40, 8, 1.5,
    '2026-08-01', null, true, '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001'),
  ('${ARRANGEMENT_A2_SALARY}', '${STAFF_A2}', 'salaried', null, 24000, 2000, 40, 8, 1,
    '2026-08-01', null, true, '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001'),
  ('${ARRANGEMENT_B_HOURLY}', '${STAFF_B}', 'hourly', 15, null, null, 37.5, 7.5, 1.5,
    '2026-08-01', null, true, '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001');

insert into public.clock_events (
  id, organisation_id, site_id, staff_id, event_type, event_timestamp, event_source
) values
  ('${EVENT_A_CLOCK_IN}', '${ORG_A}', '${SITE_A1}', '${STAFF_A}', 'clock_in', '2026-08-03T08:00:00+01:00', 'kiosk'),
  ('${EVENT_A_CLOCK_OUT}', '${ORG_A}', '${SITE_A1}', '${STAFF_A}', 'clock_out', '2026-08-03T16:00:00+01:00', 'kiosk'),
  ('${EVENT_A2_MALFORMED_CLOCK_OUT}', '${ORG_A}', '${SITE_A2}', '${STAFF_A2}', 'clock_out', '2026-08-03T15:00:00+01:00', 'kiosk'),
  ('${EVENT_B_CLOCK_IN}', '${ORG_B}', '${SITE_B1}', '${STAFF_B}', 'clock_in', '2026-08-03T09:00:00+01:00', 'kiosk'),
  ('${EVENT_B_CLOCK_OUT}', '${ORG_B}', '${SITE_B1}', '${STAFF_B}', 'clock_out', '2026-08-03T17:00:00+01:00', 'kiosk');

insert into public.clock_event_corrections (
  id, batch_id, correction_role, organisation_id, site_id, staff_id,
  correction_kind, original_event_id, event_type, event_timestamp, recorded_date,
  reason, created_by, created_by_membership_id
) values (
  '${CORRECTION_A_CLOCK_OUT}', '53000000-0000-0000-0000-000000000001', 'manager',
  '${ORG_A}', '${SITE_A1}', '${STAFF_A}', 'replace', '${EVENT_A_CLOCK_OUT}',
  'clock_out', '2026-08-03T16:30:00+01:00', '2026-08-03',
  'Confirmed corrected finish time', '99000000-0000-0000-0000-000000000001', '${MEMBERSHIP_A_OWNER}'
);
`;

export type PayrollResult = {
  ok: boolean;
  code: string;
  [key: string]: unknown;
};

export type PayrollPreparationRowInput = {
  staffId: string;
  sourceKind?: "attendance" | "staff_summary";
  siteId: string | null;
  payArrangementId: string | null;
  operationalDate: string;
  sourceKey: string;
  payType: "hourly" | "salaried" | null;
  rawMinutes: number;
  adjustmentMinutes: number;
  payableMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  hourlyRate: number | null;
  annualSalary: number | null;
  monthlySalary: number | null;
  overtimeMultiplier: number | null;
  estimatedGrossValue: number | null;
  currencyCode: "GBP";
  warnings: string[];
};

export async function createPayrollTenancyDatabase(): Promise<PGlite> {
  const db = await createAttendanceTenancyDatabase();
  await resetTenantDatabaseRole(db);
  await db.exec(inheritedPayrollSql);
  await db.exec(`
    create or replace function extensions.digest(candidate text, algorithm text)
    returns bytea language sql immutable as $$
      select decode(md5(candidate) || md5(algorithm || ':' || candidate), 'hex')
    $$
  `);
  const migrations = readdirSync(resolve("supabase/migrations"))
    .filter((name) => name.endsWith("_payroll_reporting_tenancy.sql")
      || name.endsWith("_payroll_final_review_fixes.sql")
      || name.endsWith("_payroll_adjustment_remediation.sql"))
    .sort();
  if (migrations.length !== 3
    || migrations.filter((name) => name.endsWith("_payroll_adjustment_remediation.sql")).length !== 1) {
    throw new Error("payroll tenancy remediation migration is missing or ambiguous");
  }
  for (const migration of migrations) {
    await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  }
  await db.exec(payrollFixtureSql);
  return db;
}

export function hourlyRow(overrides: Partial<PayrollPreparationRowInput> = {}): PayrollPreparationRowInput {
  return {
    staffId: STAFF_A,
    siteId: SITE_A1,
    payArrangementId: ARRANGEMENT_A_HOURLY,
    operationalDate: "2026-08-03",
    sourceKey: `${ORG_A}:${STAFF_A}:2026-08-03:${SITE_A1}`,
    payType: "hourly",
    rawMinutes: 510,
    adjustmentMinutes: 0,
    payableMinutes: 510,
    ordinaryMinutes: 510,
    overtimeMinutes: 0,
    hourlyRate: 12.5,
    annualSalary: null,
    monthlySalary: null,
    overtimeMultiplier: 1.5,
    estimatedGrossValue: 106.25,
    currencyCode: "GBP",
    warnings: [],
    ...overrides,
  };
}

export function salariedMalformedRow(
  overrides: Partial<PayrollPreparationRowInput> = {},
): PayrollPreparationRowInput {
  return {
    staffId: STAFF_A2,
    siteId: SITE_A2,
    payArrangementId: ARRANGEMENT_A2_SALARY,
    operationalDate: "2026-08-03",
    sourceKey: `${ORG_A}:${STAFF_A2}:2026-08-03:${SITE_A2}`,
    payType: "salaried",
    rawMinutes: 0,
    adjustmentMinutes: 0,
    payableMinutes: 0,
    ordinaryMinutes: 0,
    overtimeMinutes: 0,
    hourlyRate: null,
    annualSalary: 24000,
    monthlySalary: 2000,
    overtimeMultiplier: 1,
    estimatedGrossValue: null,
    currencyCode: "GBP",
    warnings: ["malformed_sequence"],
    ...overrides,
  };
}

export function warningReadiness() {
  return {
    issues: [
      {
        code: "unreviewed_day",
        severity: "warning",
        organisationId: ORG_A,
        staffId: STAFF_A,
        siteId: SITE_A1,
        operationalDate: "2026-08-03",
        sourceId: null,
      },
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
    counts: { blocker: 0, warning: 1, informational: 1 },
  };
}

export function blockedReadiness() {
  return {
    issues: [
      {
        code: "malformed_sequence",
        severity: "blocker",
        organisationId: ORG_A,
        staffId: STAFF_A2,
        siteId: SITE_A2,
        operationalDate: "2026-08-03",
        sourceId: null,
      },
      {
        code: "unreviewed_day",
        severity: "warning",
        organisationId: ORG_A,
        staffId: STAFF_A2,
        siteId: SITE_A2,
        operationalDate: "2026-08-03",
        sourceId: null,
      },
      ...warningReadiness().issues,
    ],
    counts: { blocker: 1, warning: 2, informational: 1 },
  };
}

export async function createPeriod(db: PGlite, input: {
  organisationId?: string;
  periodStart: string;
  periodEnd: string;
  operationId: string;
}): Promise<PayrollResult> {
  const result = await db.query<{ value: PayrollResult }>(
    `select public.create_commercial_payroll_period($1::uuid,$2::date,$3::date,$4::uuid) value`,
    [input.organisationId ?? ORG_A, input.periodStart, input.periodEnd, input.operationId],
  );
  return result.rows[0].value;
}

export async function persistPreparation(db: PGlite, input: {
  periodId: string;
  siteId?: string | null;
  expectedRevision: number | null;
  operationId: string;
  rows?: PayrollPreparationRowInput[];
  readiness?: Record<string, unknown>;
  inputFingerprint?: string;
  attendanceFingerprint?: string;
  payArrangementFingerprint?: string;
}): Promise<PayrollResult> {
  const rows = input.rows ?? [hourlyRow()];
  const result = await db.query<{ value: PayrollResult }>(
    `select public.persist_commercial_payroll_preparation(
      $1::uuid,$2::uuid,$3::integer,$4::uuid,$5,$6,$7,$8::jsonb,$9::jsonb
    ) value`,
    [
      input.periodId,
      input.siteId ?? null,
      input.expectedRevision,
      input.operationId,
      input.inputFingerprint ?? SHA_A,
      input.attendanceFingerprint ?? SHA_B,
      input.payArrangementFingerprint ?? SHA_C,
      JSON.stringify(rows),
      JSON.stringify(input.readiness ?? warningReadiness()),
    ],
  );
  return result.rows[0].value;
}

export async function acknowledgeWarnings(db: PGlite, input: {
  periodId: string;
  expectedRevision: number | null;
  operationId: string;
  warningCodes: string[];
  note: string;
}): Promise<PayrollResult> {
  const result = await db.query<{ value: PayrollResult }>(
    `select public.acknowledge_commercial_payroll_warnings(
      $1::uuid,$2::integer,$3::uuid,$4::text[],$5
    ) value`,
    [input.periodId, input.expectedRevision, input.operationId, input.warningCodes, input.note],
  );
  return result.rows[0].value;
}

export async function approvePreparation(db: PGlite, input: {
  periodId: string;
  expectedRevision: number | null;
  operationId: string;
}): Promise<PayrollResult> {
  const result = await db.query<{ value: PayrollResult }>(
    `select public.approve_commercial_payroll_preparation_v2($1::uuid,$2::integer,$3::uuid) value`,
    [input.periodId, input.expectedRevision, input.operationId],
  );
  return result.rows[0].value;
}

export async function reopenPreparation(db: PGlite, input: {
  periodId: string;
  expectedRevision: number | null;
  operationId: string;
  reason: string;
}): Promise<PayrollResult> {
  const result = await db.query<{ value: PayrollResult }>(
    `select public.reopen_commercial_payroll_preparation($1::uuid,$2::integer,$3::uuid,$4) value`,
    [input.periodId, input.expectedRevision, input.operationId, input.reason],
  );
  return result.rows[0].value;
}

export async function createAdjustment(db: PGlite, input: {
  periodId: string;
  expectedRevision: number | null;
  operationId: string;
  staffId: string;
  siteId?: string | null;
  adjustmentMinutes: number;
  reason: string;
}): Promise<PayrollResult> {
  if (input.expectedRevision === null) {
    const existing = await db.query<{ exists: boolean }>(`
      select exists(select 1 from public.payroll_adjustments
        where period_id=$1::uuid and operation_id=$2::uuid) exists
    `, [input.periodId, input.operationId]);
    if (existing.rows[0].exists) return { ok: false, code: "operation_conflict" };
  }
  const target = await db.query<{ operational_date: string | null }>(`
    select row_value.operational_date::text
    from public.payroll_preparation_rows row_value
    join public.payroll_preparation_runs run
      on run.organisation_id=row_value.organisation_id and run.id=row_value.run_id
    join public.payroll_periods period
      on period.organisation_id=run.organisation_id and period.id=run.period_id
    where period.id=$1::uuid and run.revision=period.revision
      and row_value.staff_id=$2
      and row_value.site_id is not distinct from $3::uuid
      and row_value.source_key not like 'staff-summary:%'
      and row_value.source_key not like 'adjustment-summary:%'
    order by row_value.operational_date,row_value.source_key limit 1
  `, [input.periodId, input.staffId, input.siteId ?? null]);
  const created = await createAdjustmentV2(db, {
    periodId: input.periodId,
    expectedRevision: input.expectedRevision,
    operationId: input.operationId,
    target: target.rows[0]?.operational_date && input.siteId
      ? {
        kind: "attendance",
        staffId: input.staffId,
        siteId: input.siteId,
        operationalDate: target.rows[0].operational_date,
      }
      : input.siteId
        ? { kind: "site_summary", staffId: input.staffId, siteId: input.siteId }
        : { kind: "organisation_summary", staffId: input.staffId },
    adjustmentMinutes: input.adjustmentMinutes,
    reason: input.reason,
  });
  if (!created.ok) {
    if (created.code === "invalid_target") return { ok: false, code: "invalid_staff" };
    if (created.code === "negative_target_total") {
      return { ok: false, code: "adjustment_exceeds_source" };
    }
    return created;
  }
  if (created.code === "adjustment_reused") {
    const revision = await db.query<{ revision: number; run_id: string }>(`
      select period.revision,run.id::text run_id
      from public.payroll_periods period
      join public.payroll_preparation_runs run
        on run.organisation_id=period.organisation_id
       and run.period_id=period.id and run.revision=period.revision
      where period.id=$1::uuid`,
      [input.periodId],
    );
    return { ...created, revision: revision.rows[0].revision, runId: revision.rows[0].run_id };
  }

  await resetTenantDatabaseRole(db);
  const snapshot = await db.query<{
    input_fingerprint: string;
    attendance_fingerprint: string;
    pay_arrangement_fingerprint: string;
    readiness: Record<string, unknown>;
    site_filter_id: string | null;
    organisation_id: string;
    period_start: string;
    period_end: string;
    rows: PayrollPreparationRowInput[];
  }>(`
    select run.input_fingerprint,run.attendance_fingerprint,
      run.pay_arrangement_fingerprint,run.readiness,run.site_filter_id::text,
      run.organisation_id::text,period.period_start::text,period.period_end::text,
      coalesce(jsonb_agg(jsonb_build_object(
        'staffId',row_value.staff_id,
        'sourceKind',case when row_value.source_key like 'staff-summary:%'
          then 'staff_summary' else 'attendance' end,
        'siteId',row_value.site_id,
        'payArrangementId',coalesce(current_arrangement.id,row_value.pay_arrangement_id),
        'operationalDate',row_value.operational_date,
        'sourceKey',row_value.source_key,
        'payType',coalesce(current_arrangement.pay_type,row_value.pay_type),
        'rawMinutes',row_value.raw_minutes,
        'adjustmentMinutes',0,
        'payableMinutes',row_value.raw_minutes,
        'ordinaryMinutes',least(row_value.ordinary_minutes,row_value.raw_minutes),
        'overtimeMinutes',greatest(0,row_value.raw_minutes-least(row_value.ordinary_minutes,row_value.raw_minutes)),
        'hourlyRate',coalesce(current_arrangement.hourly_rate,row_value.hourly_rate),
        'annualSalary',coalesce(current_arrangement.annual_salary,row_value.annual_salary),
        'monthlySalary',coalesce(current_arrangement.monthly_salary,row_value.monthly_salary),
        'overtimeMultiplier',coalesce(current_arrangement.overtime_multiplier,row_value.overtime_multiplier),
        'estimatedGrossValue',case when row_value.pay_type='hourly'
          then round(row_value.raw_minutes::numeric/60
            * coalesce(current_arrangement.hourly_rate,row_value.hourly_rate),2)
          else null end,
        'currencyCode',row_value.currency_code,
        'warnings',row_value.warnings
      ) order by row_value.staff_id,row_value.operational_date,row_value.source_key)
        filter (where row_value.source_key not like 'adjustment-summary:%'), '[]'::jsonb) rows
    from public.payroll_preparation_runs run
    join public.payroll_periods period
      on period.organisation_id=run.organisation_id and period.id=run.period_id
    join public.payroll_preparation_rows row_value
      on row_value.organisation_id=run.organisation_id and row_value.run_id=run.id
    left join lateral (
      select arrangement.* from public.staff_pay_arrangements arrangement
      where arrangement.organisation_id=row_value.organisation_id
        and arrangement.staff_id=row_value.staff_id and arrangement.is_active
        and arrangement.effective_from <= row_value.operational_date
        and (arrangement.effective_to is null
          or arrangement.effective_to >= row_value.operational_date)
      order by arrangement.effective_from desc,arrangement.id limit 1
    ) current_arrangement on true
    where period.id=$1::uuid and run.revision=period.revision
    group by run.id,period.period_start,period.period_end
  `, [input.periodId]);
  const canonical = await db.query<{
    source_key: string;
    ordinary_minutes: number;
    overtime_minutes: number;
    estimated_gross_value: string | null;
  }>(`
    select source_key,ordinary_minutes,overtime_minutes,estimated_gross_value::text
    from private.payroll_canonical_arithmetic(
      $1::uuid,$2::date,$3::date,$4::jsonb
    )
  `, [snapshot.rows[0].organisation_id, snapshot.rows[0].period_start,
    snapshot.rows[0].period_end, JSON.stringify(snapshot.rows[0].rows)]);
  const arithmeticByKey = new Map(canonical.rows.map((row) => [row.source_key, row]));
  const baseRows = snapshot.rows[0].rows.map((row) => {
    const arithmetic = arithmeticByKey.get(row.sourceKey);
    return {
      ...row,
      ordinaryMinutes: arithmetic?.ordinary_minutes ?? row.ordinaryMinutes,
      overtimeMinutes: arithmetic?.overtime_minutes ?? row.overtimeMinutes,
      estimatedGrossValue: arithmetic?.estimated_gross_value === null
        ? null
        : Number(arithmetic?.estimated_gross_value ?? row.estimatedGrossValue),
    };
  });
  await setTenantAuthUser(db, USER_A_OWNER, "aal2");
  const preparation = await persistPreparation(db, {
    periodId: input.periodId,
    siteId: snapshot.rows[0].site_filter_id,
    expectedRevision: Number(created.revision),
    operationId: randomUUID(),
    rows: baseRows,
    readiness: snapshot.rows[0].readiness,
    inputFingerprint: snapshot.rows[0].input_fingerprint,
    attendanceFingerprint: snapshot.rows[0].attendance_fingerprint,
    payArrangementFingerprint: snapshot.rows[0].pay_arrangement_fingerprint,
  });
  if (!preparation.ok) return preparation;
  return { ...created, runId: preparation.runId, revision: preparation.revision };
}

export type PayrollAdjustmentTarget =
  | { kind: "attendance"; staffId: string; siteId: string; operationalDate: string }
  | { kind: "organisation_summary"; staffId: string }
  | { kind: "site_summary"; staffId: string; siteId: string };

export async function createAdjustmentV2(db: PGlite, input: {
  periodId: string;
  expectedRevision: number | null;
  operationId: string;
  target: PayrollAdjustmentTarget;
  adjustmentMinutes: number;
  reason: string;
}): Promise<PayrollResult> {
  const result = await db.query<{ value: PayrollResult }>(
    `select public.create_commercial_payroll_adjustment_v2(
      $1::uuid,$2::integer,$3::uuid,$4,$5,$6::uuid,$7::date,$8::integer,$9
    ) value`,
    [
      input.periodId,
      input.expectedRevision,
      input.operationId,
      input.target.staffId,
      input.target.kind,
      "siteId" in input.target ? input.target.siteId : null,
      input.target.kind === "attendance" ? input.target.operationalDate : null,
      input.adjustmentMinutes,
      input.reason,
    ],
  );
  return result.rows[0].value;
}

export async function replaceAdjustmentV2(db: PGlite, input: {
  periodId: string;
  expectedRevision: number | null;
  operationId: string;
  adjustmentId: string;
  adjustmentMinutes: number;
  reason: string;
}): Promise<PayrollResult> {
  const result = await db.query<{ value: PayrollResult }>(
    `select public.replace_commercial_payroll_adjustment_v2(
      $1::uuid,$2::integer,$3::uuid,$4::uuid,$5::integer,$6
    ) value`,
    [input.periodId, input.expectedRevision, input.operationId, input.adjustmentId,
      input.adjustmentMinutes, input.reason],
  );
  return result.rows[0].value;
}

export async function transitionAdjustmentV2(db: PGlite, input: {
  periodId: string;
  expectedRevision: number | null;
  operationId: string;
  adjustmentId: string;
  transition: "void" | "reverse";
  reason: string;
}): Promise<PayrollResult> {
  const result = await db.query<{ value: PayrollResult }>(
    `select public.transition_commercial_payroll_adjustment_v2(
      $1::uuid,$2::integer,$3::uuid,$4::uuid,$5,$6
    ) value`,
    [input.periodId, input.expectedRevision, input.operationId, input.adjustmentId,
      input.transition, input.reason],
  );
  return result.rows[0].value;
}

export async function recordExport(db: PGlite, input: {
  periodId: string;
  approvalId: string;
  expectedRevision: number | null;
  operationId: string;
  evidenceRevision?: number;
  rowCount?: number;
  rowFingerprint?: string;
  payableMinutes?: number;
  adjustmentMinutes?: number;
}): Promise<PayrollResult> {
  const evidence = await db.query<{ value: PayrollResult & {
    rows?: unknown[];
    rowFingerprint?: string;
    payableMinutes?: number;
    adjustmentMinutes?: number;
  } }>(
    `select public.get_commercial_approved_payroll_export($1::uuid,$2::integer) value`,
    [input.approvalId, input.evidenceRevision ?? input.expectedRevision],
  );
  const approvedExport = evidence.rows[0].value;
  if (!approvedExport.ok) return approvedExport;
  const result = await db.query<{ value: PayrollResult }>(
    `select public.record_commercial_payroll_export_v2(
      $1::uuid,$2::uuid,$3::integer,$4::uuid,'csv'::public.payroll_export_format,
      'commercial-payroll.csv',$5,$6::integer,$7,$8::bigint,$9::bigint
    ) value`,
    [
      input.periodId,
      input.approvalId,
      input.expectedRevision,
      input.operationId,
      SHA_A,
      input.rowCount ?? approvedExport.rows?.length ?? 0,
      input.rowFingerprint ?? approvedExport.rowFingerprint,
      input.payableMinutes ?? approvedExport.payableMinutes,
      input.adjustmentMinutes ?? approvedExport.adjustmentMinutes,
    ],
  );
  return result.rows[0].value;
}

export async function attendanceEvidence(db: PGlite): Promise<string> {
  await resetTenantDatabaseRole(db);
  const result = await db.query<{ value: string }>(`
    select jsonb_build_object(
      'events', coalesce((select jsonb_agg(to_jsonb(event) order by event.id) from public.clock_events event), '[]'::jsonb),
      'corrections', coalesce((select jsonb_agg(to_jsonb(correction) order by correction.id) from public.clock_event_corrections correction), '[]'::jsonb)
    )::text value
  `);
  return result.rows[0].value;
}
