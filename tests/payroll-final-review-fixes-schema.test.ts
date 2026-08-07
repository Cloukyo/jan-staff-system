import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function finalReviewMigration(): string {
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_payroll_final_review_fixes.sql"));
  expect(migration, "payroll final-review fix migration").toBeDefined();
  return readFileSync(resolve("supabase/migrations", migration!), "utf8");
}

describe("payroll final-review schema contract", () => {
  it("removes direct commercial pay writes and exposes only guarded audited commands", () => {
    const sql = finalReviewMigration();

    expect(sql).toMatch(/drop policy if exists staff_pay_arrangements_commercial_write/i);
    expect(sql).toContain("payroll_pay_arrangement_change_audits");
    expect(sql).toContain("create_commercial_staff_pay_arrangement");
    expect(sql).toMatch(/auth\.jwt\(\)\s*->>\s*'aal'[\s\S]*?'aal2'/i);
    expect(sql).toContain("private.payroll_command_actor");
    expect(sql).toMatch(/revoke all on function public\.create_commercial_staff_pay_arrangement[\s\S]*?from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.create_commercial_staff_pay_arrangement[\s\S]*?to authenticated/i);
  });

  it("adds an auditable adjustment resolution and one-time carry-forward boundary", () => {
    const sql = finalReviewMigration();

    expect(sql).toContain("payroll_adjustment_lifecycle_events");
    expect(sql).toContain("resolve_commercial_payroll_adjustment");
    expect(sql).toContain("apply_pending_payroll_adjustment_carry_forwards");
    expect(sql).toContain("carried_from_adjustment_id");
    expect(sql).toMatch(/resolution\s+in\s*\('void',\s*'carry_forward'\)/i);
  });

  it("keeps zero-minute staff summaries separate from attendance evidence", () => {
    const sql = finalReviewMigration();

    expect(sql).toContain("staff-summary:");
    expect(sql).toContain("private.payroll_authoritative_readiness");
    expect(sql).toContain("private.validate_payroll_snapshot");
    expect(sql).toContain("private.payroll_run_evidence_drift");
  });

  it("authorises import batch identifiers before returning any lookup distinction", () => {
    const sql = finalReviewMigration();

    for (const functionName of [
      "save_commercial_payroll_import_review_row",
      "update_commercial_payroll_import_batch_date",
      "mark_commercial_payroll_import_batch_ready",
      "commit_commercial_payroll_import_batch",
    ]) {
      expect(sql).toContain(`create or replace function public.${functionName}`);
    }
    expect(sql).toContain("private.authorised_payroll_import_batch");
    expect(sql).toContain("Payroll import is not authorised");
  });
});
