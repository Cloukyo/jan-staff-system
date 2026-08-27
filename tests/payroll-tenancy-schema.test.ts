// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const commercialTables = [
  "payroll_periods",
  "payroll_preparation_runs",
  "payroll_preparation_rows",
  "payroll_adjustments",
  "payroll_approvals",
  "payroll_export_audits",
] as const;

function payrollTenancyMigration(): string {
  const name = readdirSync(resolve("supabase/migrations"))
    .find((entry) => entry.endsWith("_payroll_reporting_tenancy.sql"));
  if (!name) throw new Error("payroll reporting tenancy migration is missing");
  return readFileSync(resolve("supabase/migrations", name), "utf8");
}

function tableDefinition(sql: string, table: string): string {
  const definition = sql.match(new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`, "i"));
  if (!definition) throw new Error(`${table} definition is missing`);
  return definition[0];
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

describe("payroll reporting tenancy migration contract", () => {
  it("makes every commercial payroll ledger table organisation-owned and tenant-fenced", () => {
    const sql = payrollTenancyMigration();

    for (const table of commercialTables) {
      const definition = tableDefinition(sql, table);
      expect(definition, table).toMatch(/organisation_id uuid not null/i);
      expect(definition, table).toMatch(/unique \(organisation_id, id\)/i);
      expect(sql, table).toContain(`alter table public.${table} enable row level security`);
      expect(sql, table).toMatch(new RegExp(`create (?:unique )?index ${table}_[^\\n]+ on public\\.${table} \\(organisation_id,`, "i"));
    }
  });

  it("uses composite tenant keys for every parent, staff, site and pay-arrangement link", () => {
    const sql = compactSql(payrollTenancyMigration());

    for (const fence of [
      "foreign key (organisation_id, period_id) references public.payroll_periods(organisation_id, id)",
      "foreign key (organisation_id, run_id) references public.payroll_preparation_runs(organisation_id, id)",
      "foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id)",
      "foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id)",
      "foreign key (organisation_id, pay_arrangement_id) references public.staff_pay_arrangements(organisation_id, id)",
      "foreign key (organisation_id, period_id, run_id, revision, approval_id) references public.payroll_approvals(organisation_id, period_id, run_id, revision, id)",
      "foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id)",
    ]) {
      expect(sql).toContain(fence);
    }

    expect(sql).toContain("staff_pay_arrangements_organisation_id_id_key unique (organisation_id, id)");
    expect(sql).toMatch(/unique \(organisation_id, operation_id\)/gi);
  });

  it("adds nullable ownership to legacy payroll imports without claiming existing rows", () => {
    const sql = payrollTenancyMigration();

    for (const table of ["payroll_import_batches", "payroll_import_review_rows"]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table}[\\s\\S]*?add column organisation_id uuid`, "i"));
      expect(sql).toMatch(new RegExp(`alter table public\\.${table}[\\s\\S]*?add column site_id uuid`, "i"));
      expect(sql).not.toMatch(new RegExp(`update public\\.${table}`, "i"));
      expect(sql).toMatch(new RegExp(`create policy ${table}_legacy_[^\\n]+[\\s\\S]*?organisation_id is null`, "i"));
    }

    expect(sql).toContain("payroll_import_review_rows_org_batch_fk");
    expect(sql).toContain("foreign key (organisation_id, batch_id) references public.payroll_import_batches(organisation_id, id)");
  });

  it("permits commercial reads only through payroll permission and denies direct browser writes", () => {
    const sql = payrollTenancyMigration();

    for (const table of commercialTables) {
      expect(sql).toMatch(new RegExp(`create policy ${table}_read on public\\.${table} for select to authenticated[\\s\\S]*?private\\.has_permission\\(organisation_id, 'payroll\\.read'\\)`, "i"));
    }

    expect(sql).toMatch(/revoke all on[\s\S]+payroll_periods[\s\S]+payroll_export_audits[\s\S]+from anon, authenticated/i);
    expect(sql).toMatch(/grant select on[\s\S]+payroll_periods[\s\S]+payroll_export_audits[\s\S]+to authenticated/i);
    expect(sql).toMatch(/revoke insert, update, delete on[\s\S]+payroll_periods[\s\S]+payroll_export_audits[\s\S]+from authenticated/i);
    expect(sql).not.toMatch(/grant (?:insert|update|delete)[^;]+payroll_(?:periods|preparation_runs|preparation_rows|adjustments|approvals|export_audits)[^;]+authenticated/i);
  });

  it("defines strict lifecycle, revision, value and acknowledgement constraints", () => {
    const sql = payrollTenancyMigration();

    expect(sql).toContain("create type public.payroll_period_status");
    expect(sql).toContain("create type public.payroll_preparation_status");
    expect(sql).toContain("create type public.payroll_adjustment_status");
    expect(sql).toContain("create type public.payroll_approval_status");
    expect(sql).toMatch(/period_end >= period_start/i);
    expect(sql).toMatch(/revision > 0/i);
    expect(sql).toMatch(/adjustment_minutes <> 0/i);
    expect(sql).toMatch(/length\(btrim\(reason\)\) between 5 and 2000/i);
    expect(sql).toMatch(/acknowledged_warning_codes[\s\S]+acknowledgement_note[\s\S]+payroll_approval_acknowledgement/i);
  });

  it("requires non-null acknowledgement and reopening evidence", () => {
    const approvals = tableDefinition(payrollTenancyMigration(), "payroll_approvals");

    expect(approvals).toMatch(
      /cardinality\(acknowledged_warning_codes\) > 0\s+and acknowledgement_note is not null\s+and length\(btrim\(acknowledgement_note\)\) between 5 and 2000/i,
    );
    expect(approvals).toMatch(
      /status = 'reopened'\s+and reason is not null\s+and length\(btrim\(reason\)\) between 5 and 2000/i,
    );
  });

  it("binds run, approval and supersession relationships to one logical payroll stream", () => {
    const sql = payrollTenancyMigration();
    const runs = compactSql(tableDefinition(sql, "payroll_preparation_runs"));
    const adjustments = compactSql(tableDefinition(sql, "payroll_adjustments"));
    const approvals = compactSql(tableDefinition(sql, "payroll_approvals"));
    const exports = compactSql(tableDefinition(sql, "payroll_export_audits"));

    expect(runs).toContain("unique (organisation_id, period_id, id)");
    expect(runs).toContain("unique (organisation_id, period_id, id, revision)");
    expect(runs).toContain("supersedes_revision integer");
    expect(runs).toContain(
      "foreign key (organisation_id, period_id, supersedes_run_id, supersedes_revision) references public.payroll_preparation_runs(organisation_id, period_id, id, revision)",
    );
    expect(runs).toMatch(
      /\(supersedes_run_id is null and supersedes_revision is null and revision = 1\)[\s\S]+\(supersedes_run_id is not null and supersedes_revision is not null and supersedes_run_id <> id and supersedes_revision = revision - 1 and revision > 1\s*\)/i,
    );

    expect(adjustments).toContain(
      "foreign key (organisation_id, period_id, run_id, revision) references public.payroll_preparation_runs(organisation_id, period_id, id, revision)",
    );
    expect(adjustments).toContain(
      "unique (organisation_id, period_id, run_id, revision, staff_id, id)",
    );
    expect(adjustments).toContain(
      "foreign key (organisation_id, period_id, run_id, revision, staff_id, supersedes_adjustment_id) references public.payroll_adjustments(organisation_id, period_id, run_id, revision, staff_id, id)",
    );
    expect(adjustments).toMatch(
      /supersedes_adjustment_id is null or supersedes_adjustment_id <> id/i,
    );

    expect(approvals).toContain(
      "foreign key (organisation_id, period_id, run_id, revision) references public.payroll_preparation_runs(organisation_id, period_id, id, revision)",
    );
    expect(approvals).toContain(
      "unique (organisation_id, period_id, run_id, revision, id)",
    );
    expect(exports).toContain(
      "foreign key (organisation_id, period_id, run_id, revision, approval_id) references public.payroll_approvals(organisation_id, period_id, run_id, revision, id)",
    );
  });

  it("derives payable minutes from evidence and explicit adjustments", () => {
    const rows = tableDefinition(payrollTenancyMigration(), "payroll_preparation_rows");

    expect(rows).toMatch(/raw_minutes \+ adjustment_minutes >= 0/i);
    expect(rows).toMatch(/payable_minutes = raw_minutes \+ adjustment_minutes/i);
    expect(rows).toMatch(/ordinary_minutes \+ overtime_minutes = payable_minutes/i);
  });

  it("indexes adjustment staff ownership without an intervening filter column", () => {
    const sql = payrollTenancyMigration();

    expect(sql).toMatch(
      /create index payroll_adjustments_staff_idx on public\.payroll_adjustments \(organisation_id, staff_id\)/i,
    );
  });

  it("revokes function execution and never mutates attendance evidence", () => {
    const sql = payrollTenancyMigration();

    expect(sql).toMatch(/revoke all on function private\.prevent_payroll_record_reparenting\(\) from public, anon, authenticated, service_role/i);
    const publicFunctions = [...sql.matchAll(/create or replace function public\.(\w+)\s*\(/gi)]
      .map((match) => match[1]);
    for (const functionName of publicFunctions) {
      expect(sql, functionName).toMatch(new RegExp(`revoke all on function public\\.${functionName}\\([\\s\\S]*?from public`, "i"));
    }
    expect(sql).not.toMatch(/grant execute on function public\.[^;]+ to public/i);
    expect(sql).not.toMatch(/(?:update|delete\s+from)\s+public\.(?:clock_events|clock_event_corrections)\b/i);
  });
});
