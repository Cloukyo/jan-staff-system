import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("manager invitation onboarding UI", () => {
  const component = readFileSync(
    "src/components/onboarding/manager-invitations.tsx",
    "utf8",
  );
  const page = readFileSync("src/app/onboarding/managers/page.tsx", "utf8");
  it("uses the fixed role presentation and keeps invitation, delivery and acceptance status separate", () => {
    expect(component).toContain("MANAGER_ROLE_PRESENTATION");
    expect(component).toContain("Email delivery");
    expect(component).toContain("Acceptance");
    expect(component).not.toContain("membership.manage");
  });
  it("supports accessible site scope, resend, revoke and sole-manager acknowledgement", () => {
    expect(component).toContain('aria-describedby="site-scope-help"');
    expect(component).toContain("Resend invitation");
    expect(component).toContain("Revoke invitation");
    expect(component).toContain("manage this site myself for now");
    expect(component).toContain("minHeight: 44");
  });
  it("uses authoritative production state without demo fallback", () => {
    expect(page).toContain("loadOnboardingBootstrapServer");
    expect(page).not.toContain("demo");
    expect(page).toContain("/mfa?next=/onboarding/managers");
  });
});
