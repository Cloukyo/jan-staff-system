// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function remediationMigration(): string {
  const names = readdirSync(resolve("supabase/migrations"))
    .filter((name) => name.endsWith("_payroll_adjustment_remediation.sql"));
  expect(names, "exactly one additive payroll adjustment remediation migration").toHaveLength(1);
  return readFileSync(resolve("supabase/migrations", names[0]), "utf8");
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

describe("payroll adjustment remediation schema contract", () => {
  it("defines one effective adjustment projection and immutable run snapshots", () => {
    const sql = compactSql(remediationMigration());

    expect(sql).toMatch(/create table public\.payroll_run_adjustment_snapshots \(/i);
    expect(sql).toContain("staff_id text not null");
    expect(sql).toContain("unique (organisation_id, run_id, adjustment_id)");
    expect(sql).toContain("foreign key (organisation_id, adjustment_id) references public.payroll_adjustments(organisation_id, id)");
    expect(sql).toContain("foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id)");
    expect(sql).toContain("alter table public.payroll_run_adjustment_snapshots enable row level security");
    expect(sql).toMatch(/create trigger payroll_run_adjustment_snapshots_immutable[\s\S]*?before update or delete/i);
    expect(sql).toMatch(/private\.effective_commercial_payroll_adjustments\( target_organisation_id uuid, target_period_id uuid, target_site_filter_id uuid, source_run_id uuid default null \)/i);
    expect(sql).toMatch(/returns table \( adjustment_id uuid, lineage_root_id uuid, staff_id text, target_kind text, site_id uuid, operational_date date, adjustment_minutes integer, reason text, created_at timestamptz \)/i);
    expect(sql).toMatch(/if source_run_id is null then[\s\S]*?adjustment\.status = 'active'/i);
    expect(sql).toMatch(/else[\s\S]*?from public\.payroll_run_adjustment_snapshots snapshot/i);
  });

  it("retires carry replay without editing recorded migrations", () => {
    const sql = compactSql(remediationMigration());

    expect(sql).toContain("drop trigger if exists payroll_periods_apply_adjustment_carry_forwards on public.payroll_periods");
    expect(sql).toContain("drop function if exists private.apply_pending_payroll_adjustment_carry_forwards()");
    expect(sql).toMatch(/revoke all on function public\.create_commercial_payroll_adjustment\(\s*uuid, integer, uuid, text, uuid, integer, text\s*\)[\s\S]*?from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function public\.resolve_commercial_payroll_adjustment\(\s*uuid, integer, uuid, uuid, text, text\s*\)[\s\S]*?from public, anon, authenticated, service_role/i);
    expect(sql).not.toMatch(/grant execute on function public\.(?:create|resolve)_commercial_payroll_adjustment\(/i);
  });

  it("stores lifecycle and stable targets independently of pay arrangements", () => {
    const sql = compactSql(remediationMigration());

    expect(sql).toContain("add column target_kind text");
    expect(sql).toContain("add column target_operational_date date");
    expect(sql).toContain("add column lineage_root_id uuid");
    expect(sql).toContain("add column replaces_adjustment_id uuid");
    expect(sql).toContain("target_kind in ('attendance', 'organisation_summary', 'site_summary')");
    expect(sql).toContain("foreign key (organisation_id, lineage_root_id) references public.payroll_adjustments(organisation_id, id)");
    expect(sql).toContain("foreign key (organisation_id, replaces_adjustment_id) references public.payroll_adjustments(organisation_id, id)");
    expect(sql).toMatch(/create unique index payroll_adjustments_one_active_lineage_idx[\s\S]*?where status = 'active'/i);
    expect(sql).not.toMatch(/alter type public\.payroll_adjustment_status add value/i);
  });

  it("guards lifecycle functions with tenant permissions", () => {
    const sql = compactSql(remediationMigration());

    for (const signature of [
      "create_commercial_payroll_adjustment_v2(uuid, integer, uuid, text, text, uuid, date, integer, text)",
      "replace_commercial_payroll_adjustment_v2(uuid, integer, uuid, uuid, integer, text)",
      "transition_commercial_payroll_adjustment_v2(uuid, integer, uuid, uuid, text, text)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated, service_role`);
      expect(sql).toContain(`grant execute on function public.${signature} to authenticated`);
    }
    expect(sql.match(/security definer set search_path = ''/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("private.has_permission");
    expect(sql).toContain("private.has_site_permission");
    expect(sql).toContain("'aal2_required'");
    expect(sql).toContain("'permission_denied'");
    expect(sql).toContain("'operation_conflict'");
  });
});
