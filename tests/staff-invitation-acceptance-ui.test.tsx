import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("staff invitation acceptance UI", () => {
  it("supports safe recovery and explains exact profile linking without manager navigation", () => {
    const source = readFileSync(
      "src/components/invitations/staff-invitation-acceptance.tsx",
      "utf8",
    );
    expect(source).toMatch(/linked to your staff profile/i);
    expect(source).toMatch(/Sign in/);
    expect(source).toMatch(/Create an account/);
    expect(source).toMatch(/Verify your email/);
    expect(source).toMatch(/invitation has expired/i);
    expect(source).not.toMatch(/manager-only|organisation owner/);
  });
});
