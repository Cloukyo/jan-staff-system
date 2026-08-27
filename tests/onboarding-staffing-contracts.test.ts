import { describe, expect, it } from "vitest";
import { manualStaffPayloadSchema, staffingSkipPayloadSchema } from "@/lib/onboarding/staffing-contracts";

describe("commercial onboarding staffing contracts", () => {
  it("accepts minimum safe manual staff without pay, PIN or compliance", () => {
    expect(manualStaffPayloadSchema.parse({ externalStaffId: "EMP-001", fullName: "Alex Morgan", displayName: "Alex", email: "",
      employmentStatus: "active", startDate: "2026-09-01", jobRole: "staff", attendanceEligible: true })).not.toHaveProperty("pin");
  });
  it("rejects unsupported roles and ambiguous dates", () => {
    expect(manualStaffPayloadSchema.safeParse({ externalStaffId: "EMP-001", fullName: "Alex Morgan", displayName: "Alex",
      employmentStatus: "active", startDate: "01/09/2026", jobRole: "owner", attendanceEligible: true }).success).toBe(false);
  });
  it("requires an explicit not-ready acknowledgement to skip", () => {
    expect(staffingSkipPayloadSchema.safeParse({ acknowledgement: "later" }).success).toBe(false);
    expect(staffingSkipPayloadSchema.parse({ acknowledgement: "staffing_not_ready" })).toBeTruthy();
  });
});
