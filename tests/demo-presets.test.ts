import { describe, expect, it } from "vitest";
import { createSeedState } from "@/lib/demo-data/seed";
import { migrateState } from "@/lib/repositories/demo-store";

describe("industry demo presets", () => {
  it.each([
    ["nursery", "Nursery Practitioner", "Preschool room", "nursery.demo"],
    ["care_home", "Care Assistant", "Residential unit", "care.demo"],
    ["tuition_centre", "Tutor", "Classroom 1", "tuition.demo"],
    ["clinic", "Clinic Assistant", "Reception", "clinic.demo"],
  ] as const)("builds a %s preset", (profile, role, workArea, domain) => {
    const state = createSeedState(profile);
    expect(state.industryProfileId).toBe(profile);
    expect(state.staff.some((person) => person.role === role)).toBe(true);
    expect(state.rota.some((shift) => shift.workArea === workArea)).toBe(true);
    expect(state.staffAccounts.every((account) => account.email.endsWith(`@${domain}`))).toBe(true);
  });

  it("does not leak nursery or Jan content into the clinic preset", () => {
    const state = createSeedState("clinic");
    expect(JSON.stringify(state).toLowerCase()).not.toMatch(/jan|nursery|preschool|room leader|childcare/);
  });
});

describe("settings compatibility", () => {
  it("hydrates a legacy nursery display name into neutral display fields", () => {
    const state = migrateState({
      settings: {
        ...createSeedState("nursery").settings,
        organisationDisplayName: undefined,
        siteDisplayName: undefined,
        nurseryDisplayName: "Legacy Nursery Name",
      },
    });
    expect(state.settings.organisationDisplayName).toBe("Legacy Nursery Name");
    expect(state.settings.siteDisplayName).toBe("Legacy Nursery Name");
  });
});
