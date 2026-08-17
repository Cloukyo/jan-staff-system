import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commercialAdminNavigation, navigationForPermissions } from "@/lib/navigation/manager-navigation";

describe("commercial administration navigation", () => {
  it("hides links that the current membership cannot use", () => {
    const result = navigationForPermissions(commercialAdminNavigation, ["site.manage", "staff.manage"]);
    const links = result.flatMap((group) => group.items.map((item) => item.href));
    expect(links).toContain("/admin/sites");
    expect(links).toContain("/admin/staff");
    expect(links).not.toContain("/admin/access");
    expect(links).not.toContain("/admin/devices");
    expect(links).toContain("/dashboard");
  });

  it("keeps component-valued navigation on the client side", () => {
    const page = readFileSync(resolve("src/components/commercial-admin/commercial-admin-page.tsx"), "utf8");
    const shell = readFileSync(resolve("src/components/layout/app-shell.tsx"), "utf8");
    expect(page).toContain("commercialPermissions={snapshot.actor.permissions}");
    expect(page).not.toContain("navigation={");
    expect(shell).toContain("navigationForPermissions(commercialAdminNavigation, commercialPermissions)");
  });

  it("shows billing only to billing-authorised commercial members", () => {
    const billing = navigationForPermissions(commercialAdminNavigation, ["billing.manage"])
      .flatMap((group) => group.items.map((item) => item.href));
    const siteOnly = navigationForPermissions(commercialAdminNavigation, ["site.manage"])
      .flatMap((group) => group.items.map((item) => item.href));
    expect(billing).toContain("/admin/billing");
    expect(siteOnly).not.toContain("/admin/billing");
  });

  it("surfaces the approved post-live security controls", () => {
    const controls = readFileSync(resolve("src/components/commercial-admin/admin-extra-controls.tsx"), "utf8");
    for (const command of [
      "set_staff_attendance_eligibility",
      "update_membership_access",
      "suspend_membership",
      "revoke_membership",
      "resend_invitation",
      "revoke_invitation",
      "replace_kiosk_device",
    ]) expect(controls).toContain(`commandName=\"${command}\"`);
  });

  it("keeps the staging project manual-only at the repository boundary", () => {
    const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8"));
    expect(vercel.git.deploymentEnabled).toBe(false);
  });

  it("keeps non-function action state outside the use-server module", () => {
    const actions = readFileSync(resolve("src/lib/commercial-admin/actions.ts"), "utf8");
    const state = readFileSync(resolve("src/lib/commercial-admin/action-state.ts"), "utf8");
    expect(actions).not.toContain("export const initialCommercialAdminActionState");
    expect(state).toContain("initialCommercialAdminActionState");
  });

  it("keeps a replacement registration code visible until the manager copies it", () => {
    const actions = readFileSync(resolve("src/lib/commercial-admin/actions.ts"), "utf8");
    expect(actions).toContain('command.data !== "replace_kiosk_device"');
  });
});
