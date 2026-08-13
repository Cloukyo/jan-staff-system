import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const formSource = readFileSync("src/components/onboarding/plan-selection-form.tsx", "utf8");
const pageSource = readFileSync("src/app/onboarding/plan/page.tsx", "utf8");
const styles = readFileSync("src/app/platform.css", "utf8");

describe("commercial plan-selection UI contract", () => {
  it("explains the generous no-card trial without pretending Preview pricing is final", () => {
    expect(formSource).toContain("60 days from Go Live");
    expect(formSource).toContain("No card required");
    expect(formSource).toContain("Setup time does not use any trial days");
    expect(formSource).toContain("Pricing is not yet commercially finalised");
    expect(formSource).not.toMatch(/discount|countdown|limited time|stripe|card number/i);
  });

  it("uses server plans, duplicate-submit prevention and neutral platform wording", () => {
    expect(pageSource).toContain("snapshot.planCatalogue");
    expect(formSource).toContain("plans.map");
    expect(formSource).toContain("disabled={pending || plans.length === 0}");
    expect(formSource).not.toMatch(/nursery|preschool|offline authori[sz]ation/i);
  });

  it("retains visible focus and mobile-sized actions", () => {
    expect(styles).toMatch(/onboarding-plan-card:focus-within/);
    expect(styles).toMatch(/min-height:\s*48px/);
  });
});
