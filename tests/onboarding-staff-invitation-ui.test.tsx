import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("staff invitation onboarding UI", () => {
  it("explains optional accounts and exposes accessible reviewed bulk controls", () => {
    const source = readFileSync(
      "src/components/onboarding/staff-invitations.tsx",
      "utf8",
    );
    expect(source).toMatch(/Invite staff later/);
    expect(source).toMatch(/PIN-only/);
    expect(source).toMatch(/Select staff to invite/);
    expect(source).toMatch(/Review selected staff/);
    expect(source).toMatch(/Back to selection/);
    expect(source).toMatch(/Sending creates one invitation/);
    expect(source).toMatch(/aria-describedby/);
    expect(source).toMatch(/minHeight:\s*44/);
    expect(source).not.toMatch(/organisation_owner|site_manager/);
  });
  it("has a dedicated authoritative onboarding route", () => {
    const page = readFileSync(
      "src/app/onboarding/staff-invitations/page.tsx",
      "utf8",
    );
    expect(page).toMatch(/snapshot\.staffInvitations/);
    expect(page).toMatch(/activeStep="staff_invitations"/);
  });
});
