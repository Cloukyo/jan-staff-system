import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260911000235_rota_readiness_projection.sql", "utf8").toLowerCase();

describe("commercial rota readiness projection migration", () => {
  it("preserves the guarded snapshot signature and returns only date-specific eligibility", () => {
    expect(sql).toContain("get_commercial_rota_snapshot(target_organisation_id uuid,target_site_id uuid,target_week_start date)");
    expect(sql).toContain("private.has_site_permission(target_organisation_id,target_site_id,'rota.read')");
    expect(sql).toContain("private.staff_may_begin_work(target_organisation_id,profile.id,day.value)");
    expect(sql).toContain("'operational_readiness'");
    expect(sql).toContain("security definer set search_path = ''");
    expect(sql).not.toContain("dbs_reference_encrypted");
  });
});
