// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSql(): string {
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_rota_leave_tenancy.sql"));
  if (!migration) throw new Error("rota and leave tenancy migration is missing");
  return readFileSync(resolve("supabase/migrations", migration), "utf8");
}

describe("rota and leave tenancy migration contract", () => {
  it("adds commercial ownership to every rota and leave table", () => {
    const sql = migrationSql();
    for (const table of [
      "rota_settings",
      "rota_weeks",
      "rota_shifts",
      "rota_templates",
      "rota_template_shifts",
      "rota_template_applications",
      "leave_requests",
    ]) {
      expect(sql).toContain(`alter table public.${table}`);
    }
    expect(sql).toContain("organisation_id uuid");
    expect(sql).toContain("site_id uuid");
    expect(sql).toContain("work_area_id uuid");
    expect(sql).toContain("source_site_id uuid");
  });

  it("persists unspecified-break evidence on commercial template shifts", () => {
    const followUp = readFileSync(
      resolve("supabase/migrations/20260814144500_commercial_rota_template_breaks.sql"),
      "utf8",
    );

    expect(followUp).toMatch(
      /alter table public\.rota_template_shifts[\s\S]*break_unspecified boolean not null default false/,
    );
  });

  it("declares guarded commands, audit evidence and replay receipts", () => {
    const sql = migrationSql();
    for (const boundary of [
      "private.validate_commercial_rota_shift",
      "public.execute_commercial_rota_command",
      "public.execute_commercial_leave_command",
      "public.get_commercial_planned_shifts",
      "public.get_commercial_rota_snapshot",
      "public.get_commercial_leave_snapshot",
      "public.reset_commercial_attendance_to_planned_hours",
      "public.use_commercial_planned_hours",
      "commercial_rota_events",
      "commercial_leave_events",
      "commercial_operation_receipts",
    ]) {
      expect(sql).toContain(boundary);
    }
  });

  it("retains a wholly unowned Jan path and denies partial ownership", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/organisation_id is null[\s\S]+site_id is null/i);
    expect(sql).toMatch(/organisation_id is not null[\s\S]+site_id is not null/i);
    expect(sql).toContain("commercial rota ownership is immutable");
    expect(sql).toContain("commercial leave ownership is immutable");
  });

  it("uses commercial permission helpers and narrow RPC grants", () => {
    const sql = migrationSql();
    expect(sql).toContain("private.has_site_permission");
    expect(sql).toContain("private.has_permission");
    const commercialCommands = sql.slice(
      sql.indexOf("create or replace function public.execute_commercial_rota_command"),
      sql.indexOf("create or replace function public.get_commercial_planned_shifts"),
    );
    expect(commercialCommands).not.toContain("current_staff_role()");
    expect(sql).toMatch(/revoke all on function public\.execute_commercial_rota_command[\s\S]+from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.execute_commercial_rota_command[\s\S]+to authenticated/i);
    expect(sql).toMatch(/revoke all on function private\.[\s\S]+private\.validate_commercial_rota_shift[\s\S]+from public, anon, authenticated/i);
  });

  it("fences cross-tenant relationships and cross-site work areas", () => {
    const sql = migrationSql();
    expect(sql).toContain("references public.organisations(id)");
    expect(sql).toContain("references public.organisation_sites(organisation_id, id)");
    expect(sql).toContain("references public.staff_profiles(organisation_id, id)");
    expect(sql).toContain("references public.work_areas(organisation_id, site_id, id)");
    expect(sql).toContain("staff_site_assignments");
  });
});
