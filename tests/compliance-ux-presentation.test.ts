import { describe, expect, it } from "vitest";
import { recruitmentIssuePresentation, recruitmentPriorityPresentation } from "@/lib/compliance/presentation";

describe("compliance UX presentation", () => {
  it("distinguishes unconfirmed historical timing from missing or failed DBS evidence", () => {
    const result = recruitmentPriorityPresentation({ status: "blocked", evidenceState: "receipt_unconfirmed", mayStartWork: false, blockerCodes: ["dbs_receipt_timing_unconfirmed"], warningCodes: [], restrictionCodes: [] });
    expect(result.heading).toContain("Historical DBS evidence");
    expect(result.description).toContain("not a missing or failed DBS check");
    expect(result.tone).toBe("warning");
  });

  it("uses consequence-led labels for blocked and complete records", () => {
    expect(recruitmentPriorityPresentation({ status: "blocked", evidenceState: "missing", mayStartWork: false, blockerCodes: ["start_not_authorised"], warningCodes: [], restrictionCodes: [] }).heading).toBe("Cannot begin operational work");
    expect(recruitmentPriorityPresentation({ status: "ready", evidenceState: "ready", mayStartWork: true, blockerCodes: [], warningCodes: [], restrictionCodes: [] }).heading).toBe("Ready to begin operational work");
  });

  it("maps blocker codes to a direct resolution target", () => {
    expect(recruitmentIssuePresentation("dbs_receipt_timing_unconfirmed")).toEqual({ label: "Confirm when the historical DBS evidence was received.", target: "dbs-receipt-confirmation" });
    expect(recruitmentIssuePresentation("start_not_authorised").target).toBe("dbs-suitability");
  });
});
