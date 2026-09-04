import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSource(): string {
  const names = readdirSync(resolve("supabase/migrations"))
    .filter((name) => name.endsWith("_nursery_staff_competitive_readiness.sql"));
  expect(names).toHaveLength(1);
  return readFileSync(resolve("supabase/migrations", names[0]), "utf8");
}

describe("competitive readiness migration contract", () => {
  it("adds tenant-scoped recruitment evidence with manager-only RLS", () => {
    const sql = migrationSource();
    expect(sql).toContain("create type public.staff_engagement_type");
    expect(sql).toContain("create table public.staff_suitability_events");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("private.has_permission(organisation_id, 'compliance.manage')");
    expect(sql).toContain("revoke all on public.staff_suitability_events from anon");
  });

  it("guards operational work and statutory retention in the database", () => {
    const sql = migrationSource();
    expect(sql).toContain("private.staff_may_begin_work");
    expect(sql).toContain("returns boolean language sql stable security invoker");
    expect(sql).toContain("staff_not_authorised_to_begin_work");
    expect(sql).toContain("private.prevent_retained_record_deletion");
    expect(sql).toContain("interval '6 years'");
    expect(sql).toContain("at time zone 'Europe/London'");
    expect(sql).toContain("create table public.holiday_pay_evidence_export_audits");
  });

  it("propagates imported engagement and DBS requirements into authoritative records", () => {
    const sql = migrationSource();
    expect(sql).toContain("apply_staff_import_recruitment_fields");
    expect(sql).toContain("normalised_data->>'engagementType'");
    expect(sql).toContain("normalised_data->>'dbsRequirement'");
  });

  it("keeps sensitive references out of ordinary public grants", () => {
    const sql = migrationSource();
    expect(sql).toContain("dbs_reference_encrypted");
    expect(sql).not.toMatch(/grant\s+select[^;]*dbs_reference_encrypted/i);
    expect(sql).toContain("security_invoker = true");
  });
});
