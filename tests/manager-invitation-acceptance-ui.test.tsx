import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("manager invitation acceptance UI", () => {
  const page = readFileSync("src/app/invitations/manager/page.tsx", "utf8");
  const component = readFileSync(
    "src/components/invitations/manager-invitation-acceptance.tsx",
    "utf8",
  );
  it("presents every safe recovery state with neutral branding", () => {
    for (const text of [
      "Sign in to continue",
      "Create an account",
      "Verify your email",
      "Complete multi-factor authentication",
      "This invitation has expired",
      "This invitation was revoked",
      "This invitation has been replaced",
      "Invitation accepted",
    ])
      expect(component + page).toContain(text);
    expect(component + page).not.toMatch(/nursery|preschool|Jan/i);
  });
  it("never accepts role or site values from the browser", () => {
    expect(component).not.toContain('name="role"');
    expect(component).not.toContain('name="siteId"');
    expect(page).toContain("inspectManagerInvitationServer");
  });
});
