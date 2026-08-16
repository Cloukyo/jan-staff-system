// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  "supabase/migrations/20260814155613_commercial_post_live_administration.sql",
);

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("commercial post-live administration migration contract", () => {
  it("provides one guarded snapshot and command boundary", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = migrationSql();
    expect(sql).toContain("public.get_commercial_admin_snapshot");
    expect(sql).toContain("public.execute_commercial_admin_command");
    expect(sql).toContain("commercial_admin_command_receipts");
    expect(sql).toContain("commercial_admin_events");
    expect(sql).toMatch(/revoke all on function[\s\S]*public\.execute_commercial_admin_command[\s\S]+from public,anon,authenticated/i);
    expect(sql).toMatch(/grant execute on function[\s\S]*public\.execute_commercial_admin_command[\s\S]+to authenticated/i);
    const hardening = readFileSync(resolve("supabase/migrations/20260814161920_harden_commercial_admin_rpc_surface.sql"), "utf8");
    expect(hardening).toContain("commercial_api_private");
    expect(hardening).toContain("security invoker");
  });

  it("covers every approved post-live domain without onboarding authority", () => {
    const sql = migrationSql();
    for (const command of [
      "update_organisation",
      "create_site",
      "update_site",
      "archive_site",
      "create_staff",
      "update_staff",
      "deactivate_staff",
      "set_staff_attendance_eligibility",
      "upsert_assignment",
      "update_membership_access",
      "suspend_membership",
      "revoke_membership",
      "create_work_area",
      "update_work_area",
      "archive_work_area",
      "create_site_closure",
      "archive_site_closure",
      "update_organisation_settings",
      "update_site_settings",
      "create_manager_invitation",
      "create_staff_invitation",
      "resend_invitation",
      "revoke_invitation",
      "start_kiosk_registration",
      "replace_kiosk_device",
      "revoke_kiosk_device",
      "require_kiosk_reprovision",
      "reset_staff_pin",
    ]) expect(sql).toContain(`'${command}'`);
    expect(sql).not.toMatch(/update\s+public\.onboarding_(sessions|step_states)/i);
  });

  it("enforces live state, AAL2, entitlements, revisions and offline prohibition", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/operational_state\s*<>\s*'live'/);
    expect(sql).toContain("auth.jwt()->>'aal'");
    expect(sql).toContain("private.commercial_capability_decision");
    expect(sql).toContain("sites.active.limit");
    expect(sql).toContain("staff.active.limit");
    expect(sql).toContain("members.privileged.limit");
    expect(sql).toContain("workflow_changed");
    expect(sql).toContain("offline_enabled=false");
    expect(sql).toContain("last_active_owner");
  });

  it("preserves evidence through archive and effective-date operations", () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/delete\s+from\s+public\.(organisations|organisation_sites|staff_profiles|kiosk_devices|work_areas|site_closures)/i);
    expect(sql).toContain("archived_at=clock_timestamp()");
    expect(sql).toContain("effective_from");
    expect(sql).toContain("effective_to");
    expect(sql).toContain("commercial administration ownership is immutable");
  });
});
