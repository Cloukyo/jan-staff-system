import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const review = readFileSync("src/components/onboarding/readiness-review.tsx", "utf8");
const page = readFileSync("src/app/onboarding/readiness/page.tsx", "utf8");
const welcome = readFileSync("src/components/commercial/live-welcome.tsx", "utf8");

describe("commercial readiness and Go Live UI", () => {
  it("renders authoritative categories with direct remediation", () => {
    expect(page).toContain("loadOnboardingBootstrapServer");
    expect(page).toContain("snapshot.readiness");
    expect(review).toContain("Needs attention");
    expect(review).toContain("remediationRoute");
    expect(review).not.toMatch(/database|SQL|clientReady/);
  });

  it("uses an explicit, accessible Go Live confirmation with honest trial copy", () => {
    expect(review).toContain("Start live attendance");
    expect(review).toContain("60-day free trial begins");
    expect(review).toContain("No payment card is required");
    expect(review).toContain("Offline attendance remains unavailable");
    expect(review).toContain('type="checkbox"');
    expect(review).toContain("required");
    expect(review).toContain("soleManagerWarning && !soleManagerAcknowledged");
  });

  it("provides a focused live landing state with UK date presentation", () => {
    expect(welcome).toContain('"en-GB"');
    expect(welcome).toContain('timeZone: "Europe/London"');
    expect(welcome).toContain("Organisation live");
    expect(welcome).toContain("Open Staff Clock");
    expect(welcome).toContain("Offline disabled");
    expect(welcome).not.toMatch(/nursery|preschool|Jan/);
  });
});
