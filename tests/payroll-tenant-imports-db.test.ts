// @vitest-environment node

import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARRANGEMENT_A2_SALARY,
  ARRANGEMENT_A_HOURLY,
  ORG_A,
  SITE_A1,
  SITE_B1,
  STAFF_A,
  STAFF_A2,
  STAFF_B,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  createPayrollTenancyDatabase,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/payroll-tenancy-db";
import { MEMBERSHIP_A_OWNER, USER_B_OWNER } from "./helpers/attendance-tenancy-db";
import { MEMBERSHIP_B_OWNER } from "./helpers/tenant-primitives-db";

const PREVIEW_OPERATION = "71000000-0000-0000-0000-000000000001";
const COMMIT_OPERATION = "72000000-0000-0000-0000-000000000001";

type ImportReceipt = {
  ok: boolean;
  code: string;
  reused: boolean;
  organisationId: string;
  batchId: string;
  importedCount?: number;
};

function importRow(overrides: Record<string, unknown> = {}) {
  return {
    sourceRowIndex: 1,
    sourceName: "Alex Example",
    suggestedStaffId: STAFF_A,
    selectedStaffId: STAFF_A,
    matchConfidence: "high",
    resolution: "current_staff",
    payType: "hourly",
    hourlyRate: 13.25,
    annualSalary: null,
    monthlySalary: null,
    contractedWeeklyHours: 40,
    hoursBasis: "contracted",
    effectiveFrom: "2026-09-01",
    managerNotes: "Reviewed commercial import",
    sourceWarnings: [],
    duplicateMappingConfirmed: false,
    ...overrides,
  };
}

async function addFullLegacyImportShape(db: PGlite) {
  await resetTenantDatabaseRole(db);
  await db.exec(`
    alter table public.payroll_import_batches
      add column if not exists source_kind text not null default 'workbook',
      add column if not exists proposed_effective_date date,
      add column if not exists global_effective_date_confirmed boolean not null default false,
      add column if not exists approved_by uuid,
      add column if not exists approved_at timestamptz,
      add column if not exists imported_by uuid,
      add column if not exists imported_at timestamptz,
      add column if not exists updated_at timestamptz not null default now();
    alter table public.payroll_import_review_rows
      add column if not exists source_name text,
      add column if not exists match_confidence text not null default 'none',
      add column if not exists resolution text not null default 'unresolved',
      add column if not exists pay_type public.payroll_pay_type,
      add column if not exists hourly_rate numeric(10,2),
      add column if not exists annual_salary numeric(12,2),
      add column if not exists monthly_salary numeric(12,2),
      add column if not exists contracted_weekly_hours numeric(5,2),
      add column if not exists hours_basis text not null default 'contracted',
      add column if not exists effective_from date,
      add column if not exists manager_notes text,
      add column if not exists source_warnings text[] not null default '{}',
      add column if not exists duplicate_mapping_confirmed boolean not null default false,
      add column if not exists updated_at timestamptz not null default now();
    alter table public.staff_pay_arrangements
      alter column contracted_weekly_hours drop not null,
      add column if not exists import_review_row_id uuid;
  `);
}

async function preview(db: PGlite, input: {
  membershipId?: string;
  siteId?: string | null;
  operationId?: string;
  globalEffectiveDateConfirmed?: boolean;
  rows?: Record<string, unknown>[];
}) {
  const result = await db.query<{ value: ImportReceipt }>(
    `select public.preview_commercial_payroll_import_batch(
      $1::uuid,$2::uuid,$3::uuid,'commercial-payroll.xlsx','2026-09-01',$4::boolean,$5::jsonb
    ) value`,
    [
      input.membershipId ?? MEMBERSHIP_A_OWNER,
      input.siteId === undefined ? SITE_A1 : input.siteId,
      input.operationId ?? PREVIEW_OPERATION,
      input.globalEffectiveDateConfirmed ?? true,
      JSON.stringify(input.rows ?? [importRow()]),
    ],
  );
  return result.rows[0].value;
}

async function commit(db: PGlite, batchId: string, operationId = COMMIT_OPERATION) {
  const result = await db.query<{ value: ImportReceipt }>(
    "select public.commit_commercial_payroll_import_batch($1::uuid,$2::uuid) value",
    [batchId, operationId],
  );
  return result.rows[0].value;
}

describe("commercial payroll import commands", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createPayrollTenancyDatabase();
    await addFullLegacyImportShape(db);
    await resetTenantDatabaseRole(db);
    await db.query(
      "delete from public.staff_pay_arrangements where id in ($1::uuid,$2::uuid)",
      [ARRANGEMENT_A_HOURLY, ARRANGEMENT_A2_SALARY],
    );
  }, 30_000);

  afterEach(async () => {
    await db.close();
  });

  it("derives one organisation and actor membership for the batch and validates optional site metadata", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");

    const receipt = await preview(db, {});
    expect(receipt).toMatchObject({
      ok: true,
      code: "import_preview_ready",
      reused: false,
      organisationId: ORG_A,
    });

    await resetTenantDatabaseRole(db);
    const stored = await db.query<{
      organisation_id: string;
      site_id: string | null;
      created_by_membership_id: string;
      row_organisation_id: string;
      row_site_id: string | null;
    }>(`
      select batch.organisation_id::text, batch.site_id::text,
        batch.created_by_membership_id::text,
        review_row.organisation_id::text row_organisation_id,
        review_row.site_id::text row_site_id
      from public.payroll_import_batches batch
      join public.payroll_import_review_rows review_row
        on review_row.organisation_id = batch.organisation_id and review_row.batch_id = batch.id
      where batch.id = $1::uuid
    `, [receipt.batchId]);
    expect(stored.rows).toEqual([{
      organisation_id: ORG_A,
      site_id: SITE_A1,
      created_by_membership_id: MEMBERSHIP_A_OWNER,
      row_organisation_id: ORG_A,
      row_site_id: SITE_A1,
    }]);

    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await expect(preview(db, {
      siteId: SITE_B1,
      operationId: "71000000-0000-0000-0000-000000000002",
    })).rejects.toThrow(/site.*organisation|payroll import.*authorised/i);
    await expect(preview(db, {
      siteId: null,
      operationId: "71000000-0000-0000-0000-000000000003",
      rows: [importRow({ selectedStaffId: STAFF_B, suggestedStaffId: STAFF_B })],
    })).rejects.toThrow(/staff.*organisation|payroll import.*invalid/i);
  });

  it("requires payroll.prepare and AAL2 for preview and commit mutations", async () => {
    await setTenantAuthUser(db, USER_A_SITE_MANAGER, "aal2");
    await expect(preview(db, {})).rejects.toThrow(/authorised|permission/i);

    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    await expect(preview(db, {})).rejects.toThrow(/AAL2/i);

    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const receipt = await preview(db, {});
    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    await expect(commit(db, receipt.batchId)).rejects.toThrow(/AAL2/i);
  });

  it("requires a ready preview, commits atomically, and returns an idempotent receipt", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await expect(commit(db, "73000000-0000-0000-0000-000000000001"))
      .rejects.toThrow(/payroll import is not authorised/i);

    const previewReceipt = await preview(db, {});
    const first = await commit(db, previewReceipt.batchId);
    const retry = await commit(db, previewReceipt.batchId);
    expect(first).toMatchObject({
      ok: true,
      code: "import_committed",
      reused: false,
      organisationId: ORG_A,
      batchId: previewReceipt.batchId,
      importedCount: 1,
    });
    expect(retry).toEqual({ ...first, reused: true });

    await expect(commit(
      db,
      previewReceipt.batchId,
      "72000000-0000-0000-0000-000000000002",
    )).rejects.toThrow(/already imported|operation conflict/i);

    await resetTenantDatabaseRole(db);
    const arrangements = await db.query<{
      organisation_id: string;
      staff_id: string;
      site_id: string | null;
      created_by_membership_id: string;
    }>(`
      select organisation_id::text, staff_id, site_id::text, created_by_membership_id::text
      from public.staff_pay_arrangements where import_review_row_id is not null
    `);
    expect(arrangements.rows).toEqual([{
      organisation_id: ORG_A,
      staff_id: STAFF_A,
      site_id: SITE_A1,
      created_by_membership_id: MEMBERSHIP_A_OWNER,
    }]);
  });

  it("rolls back every arrangement when any previewed row becomes invalid", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const previewReceipt = await preview(db, {
      rows: [
        importRow(),
        importRow({
          sourceRowIndex: 2,
          sourceName: "Sam Example",
          suggestedStaffId: STAFF_A2,
          selectedStaffId: STAFF_A2,
          payType: "salaried",
          hourlyRate: null,
          annualSalary: 26_000,
          contractedWeeklyHours: null,
          hoursBasis: "salaried_untracked",
          duplicateMappingConfirmed: false,
        }),
      ],
    });

    await resetTenantDatabaseRole(db);
    await db.query(`
      insert into public.staff_pay_arrangements (
        id, organisation_id, staff_id, pay_type, hourly_rate, annual_salary, monthly_salary,
        contracted_weekly_hours, hours_basis, standard_daily_hours, overtime_multiplier,
        effective_from, effective_to, is_active, created_by, updated_by
      ) values (
        '74000000-0000-0000-0000-000000000001', $1::uuid, $2, 'salaried', null, 25000, null,
        null, 'salaried_untracked', null, 1, '2026-08-01', null, true,
        '99000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001'
      )
    `, [ORG_A, STAFF_A2]);

    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await expect(commit(db, previewReceipt.batchId)).rejects.toThrow(/overlap|invalid/i);

    await resetTenantDatabaseRole(db);
    const inserted = await db.query<{ count: number }>(`
      select count(*)::integer count from public.staff_pay_arrangements
      where import_review_row_id in (
        select id from public.payroll_import_review_rows where batch_id = $1::uuid
      )
    `, [previewReceipt.batchId]);
    expect(inserted.rows[0].count).toBe(0);
  });

  it("denies the commercial batch to the legacy unowned import command", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const receipt = await preview(db, {});

    await expect(db.query(
      "select public.apply_legacy_payroll_import_batch($1::uuid)",
      [receipt.batchId],
    )).rejects.toThrow(/permission denied|commercial.*legacy|legacy.*commercial|unowned/i);
  });

  it("moves an uploaded draft through guarded manager corrections to a committable preview", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const draft = await preview(db, {
      globalEffectiveDateConfirmed: false,
      rows: [importRow({
        selectedStaffId: null,
        resolution: "unresolved",
        contractedWeeklyHours: null,
      })],
    });
    expect(draft.code).toBe("import_preview_requires_review");

    await db.query(
      `select public.save_commercial_payroll_import_review_row(
        $1::uuid,$2::uuid,'current_staff',$3,'hourly',13.25,null,null,40,
        'contracted','2026-09-01','Manager confirmed workbook row',false
      )`,
      [
        draft.batchId,
        (await db.query<{ id: string }>(
          "select id::text from public.payroll_import_review_rows where batch_id = $1::uuid",
          [draft.batchId],
        )).rows[0].id,
        STAFF_A,
      ],
    );
    await db.query(
      "select public.update_commercial_payroll_import_batch_date($1::uuid,'2026-09-01',true)",
      [draft.batchId],
    );
    const ready = await db.query<{ value: ImportReceipt }>(
      "select public.mark_commercial_payroll_import_batch_ready($1::uuid,$2::uuid) value",
      [draft.batchId, "75000000-0000-0000-0000-000000000001"],
    );
    expect(ready.rows[0].value).toMatchObject({
      ok: true,
      code: "import_preview_ready",
      batchId: draft.batchId,
    });
    await expect(commit(db, draft.batchId)).resolves.toMatchObject({
      ok: true,
      code: "import_committed",
      importedCount: 1,
    });
  });

  it("requires an explicit legacy-only actor before applying an unowned Jan batch", async () => {
    await resetTenantDatabaseRole(db);
    const legacy = await db.query<{ id: string }>(`
      insert into public.payroll_import_batches (source_filename, status, created_by)
      values ('jan-legacy.xlsx', 'draft', '99000000-0000-0000-0000-000000000001')
      returning id::text
    `);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");

    await expect(db.query(
      "select public.apply_legacy_payroll_import_batch($1::uuid)",
      [legacy.rows[0].id],
    )).rejects.toThrow(/legacy-only actor|commercial membership.*legacy/i);
  });

  it("returns the same safe denial for absent and foreign commercial batch identifiers", async () => {
    await setTenantAuthUser(db, USER_B_OWNER, "aal2");
    const foreign = await preview(db, {
      membershipId: MEMBERSHIP_B_OWNER,
      siteId: SITE_B1,
      operationId: "76000000-0000-0000-0000-000000000001",
      rows: [importRow({
        sourceName: "Blair Example",
        suggestedStaffId: STAFF_B,
        selectedStaffId: STAFF_B,
      })],
    });
    const foreignRow = await db.query<{ id: string }>(
      "select id::text from public.payroll_import_review_rows where batch_id=$1::uuid",
      [foreign.batchId],
    );
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");

    async function message(query: string, values: unknown[]): Promise<string> {
      try {
        await db.query(query, values);
        return "no error";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }

    const missingBatchId = "76000000-0000-0000-0000-000000000099";
    const missingRowId = "76000000-0000-0000-0000-000000000098";
    const calls = [
      {
        query: `select public.save_commercial_payroll_import_review_row(
          $1::uuid,$2::uuid,'excluded',null,null,null,null,null,null,
          'contracted',null,'Not part of this payroll',false
        )`,
        foreign: [foreign.batchId, foreignRow.rows[0].id],
        missing: [missingBatchId, missingRowId],
      },
      {
        query: "select public.update_commercial_payroll_import_batch_date($1::uuid,'2026-09-02',true)",
        foreign: [foreign.batchId],
        missing: [missingBatchId],
      },
      {
        query: "select public.mark_commercial_payroll_import_batch_ready($1::uuid,$2::uuid)",
        foreign: [foreign.batchId, "76000000-0000-0000-0000-000000000002"],
        missing: [missingBatchId, "76000000-0000-0000-0000-000000000003"],
      },
      {
        query: "select public.commit_commercial_payroll_import_batch($1::uuid,$2::uuid)",
        foreign: [foreign.batchId, "76000000-0000-0000-0000-000000000004"],
        missing: [missingBatchId, "76000000-0000-0000-0000-000000000005"],
      },
    ];

    for (const call of calls) {
      const foreignMessage = await message(call.query, call.foreign);
      const missingMessage = await message(call.query, call.missing);
      expect(foreignMessage).toMatch(/payroll import is not authorised/i);
      expect(missingMessage).toBe(foreignMessage);
    }
  });
});

describe("payroll import application routing", () => {
  it("uses membership-derived commercial RPCs and an explicit legacy Jan branch", () => {
    const review = readFileSync(resolve("src/lib/payroll/review.ts"), "utf8");
    const actions = readFileSync(resolve("src/lib/payroll/review-actions.ts"), "utf8");

    expect(review).toContain('requireCustomerDomainActor("payroll.read")');
    expect(review).toContain('.eq("organisation_id", actor.context.organisationId)');
    expect(actions).toContain('requireCustomerDomainActor("payroll.prepare")');
    expect(actions).toContain('supabase.rpc("preview_commercial_payroll_import_batch"');
    expect(actions).toContain('supabase.rpc("commit_commercial_payroll_import_batch"');
    expect(actions).toContain('supabase.rpc("apply_legacy_payroll_import_batch"');
    expect(actions).not.toContain('supabase.rpc("apply_payroll_import_batch"');
  });
});
