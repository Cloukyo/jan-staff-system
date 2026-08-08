import { describe, expect, it } from "vitest";

import { createDemoComplianceState } from "@/lib/compliance/demo-data";

describe("commercial compliance demo-data safety", () => {
  it("uses unmistakably fictional identities without personal compliance details", () => {
    const state = createDemoComplianceState("clinic");

    expect(state.staff).toHaveLength(15);
    expect(
      state.staff.every(
        (person) =>
          /^staff-demo-person-[a-o]$/.test(person.id) &&
          /^Demo Person [A-O]$/.test(person.fullName) &&
          /^Demo [A-O]$/.test(person.displayName) &&
          person.email === null &&
          person.notes === null,
      ),
    ).toBe(true);

    expect(state.references).toEqual([]);
    expect(
      state.centralRecords.every(
        (record) =>
          record.dbsRecorded === false &&
          record.dbsUpdateService === false &&
          record.dbsIssueDate === null &&
          record.dbsLastCheckedAt === null &&
          record.dbsNumberLast4 === null &&
          record.dbsNewCheckRequired === false &&
          record.referencesComplete === false &&
          record.referencesCheckedAt === null,
      ),
    ).toBe(true);
  });
});
